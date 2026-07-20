import type {
  DocumentParser,
  NormalizedDocument,
  NormalizedDocumentElement,
  NormalizedPolygon,
  ParseOptions,
} from '@doc-rag/document-processing';
import { PageLimitExceededError } from '@doc-rag/document-processing';

/**
 * Bump when extraction output changes shape or semantics; stored on the
 * document version so stale artifacts are detectable (PLAN.md Phase 3).
 */
export const PDF_PARSER_VERSION = '1.0.0';

/** Structural subset of pdfjs text items; avoids importing internal type paths. */
interface PdfTextItem {
  str: string;
  /** [scaleX, skewY, skewX, scaleY, translateX, translateY] in PDF units. */
  transform: number[];
  width: number;
  height: number;
}

interface PositionedItem {
  text: string;
  x: number;
  /** Baseline y in PDF units (origin bottom-left). */
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

interface Line {
  items: PositionedItem[];
  y: number;
  fontSize: number;
}

interface Block {
  lines: Line[];
  fontSize: number;
}

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsModule: Promise<PdfJsModule> | undefined;

function loadPdfJs(): Promise<PdfJsModule> {
  // The legacy build is Node-compatible ESM; loaded lazily and once.
  pdfjsModule ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsModule;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Rectangle polygon in normalized top-left coordinates. PDF y grows upward
 * from the bottom; the viewer overlay (and locator contract) use top-left
 * origin, so y flips against the page height here, once, at extraction time.
 */
function toNormalizedRect(
  item: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
): NormalizedPolygon {
  const x0 = clamp01(item.x / pageWidth);
  const x1 = clamp01((item.x + item.width) / pageWidth);
  const yTop = clamp01((pageHeight - item.y - item.height) / pageHeight);
  const yBottom = clamp01((pageHeight - item.y) / pageHeight);
  return [x0, yTop, x1, yTop, x1, yBottom, x0, yBottom];
}

function groupIntoLines(items: PositionedItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    // Same line when baselines are within half the font size.
    if (current && Math.abs(current.y - item.y) <= current.fontSize * 0.5) {
      current.items.push(item);
      current.fontSize = Math.max(current.fontSize, item.fontSize);
    } else {
      lines.push({ items: [item], y: item.y, fontSize: item.fontSize });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }
  return lines;
}

function groupIntoBlocks(lines: Line[]): Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const current = blocks[blocks.length - 1];
    const previousLine = current?.lines[current.lines.length - 1];
    const gap = previousLine ? previousLine.y - line.y : Infinity;
    const sameStyle =
      current !== undefined &&
      Math.abs(current.fontSize - line.fontSize) < current.fontSize * 0.15;
    // A block continues while lines share a font size and normal leading.
    if (current && previousLine && sameStyle && gap <= line.fontSize * 1.8) {
      current.lines.push(line);
    } else {
      blocks.push({ lines: [line], fontSize: line.fontSize });
    }
  }
  return blocks;
}

function lineText(line: Line): string {
  return line.items
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export class PdfParser implements DocumentParser {
  readonly name = 'pdfjs-text';
  readonly version = PDF_PARSER_VERSION;
  readonly mimeTypes = ['application/pdf'] as const;

  async parse(
    content: Uint8Array,
    options: ParseOptions,
  ): Promise<NormalizedDocument> {
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      // pdfjs transfers (detaches) the buffer it receives; parse a copy so the
      // caller's bytes stay usable.
      data: content.slice(),
      // Untrusted input: no external font/resource fetches. (pdfjs v6 removed
      // eval-based font paths entirely, so no isEvalSupported flag anymore.)
      useSystemFonts: false,
      disableFontFace: true,
      // Text extraction needs no font files; silence the missing-font warnings.
      verbosity: 0,
    });
    const document = await loadingTask.promise;

    try {
      if (document.numPages > options.maxPages) {
        throw new PageLimitExceededError(document.numPages, options.maxPages);
      }

      const pages: NormalizedDocument['pages'] = [];
      const pageBlocks: { page: number; blocks: Block[] }[] = [];
      const allFontSizes: number[] = [];

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        pages.push({
          page: pageNumber,
          width: viewport.width,
          height: viewport.height,
        });

        const textContent = await page.getTextContent();
        const positioned: PositionedItem[] = [];
        for (const raw of textContent.items) {
          if (!('str' in raw)) continue;
          const item = raw as PdfTextItem;
          if (item.str.trim().length === 0) continue;
          const fontSize = Math.abs(item.transform[3]) || item.height || 1;
          positioned.push({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: item.height || fontSize,
            fontSize,
          });
          allFontSizes.push(fontSize);
        }
        pageBlocks.push({
          page: pageNumber,
          blocks: groupIntoBlocks(groupIntoLines(positioned)),
        });
      }

      const bodyFontSize = median(allFontSizes) || 1;
      const elements: NormalizedDocumentElement[] = [];
      for (const { page, blocks } of pageBlocks) {
        const dims = pages[page - 1];
        for (const block of blocks) {
          const text = block.lines
            .map(lineText)
            .filter(Boolean)
            .join(' ')
            .trim();
          if (!text) continue;
          const polygons = block.lines.flatMap((line) =>
            line.items.map((item) =>
              toNormalizedRect(item, dims.width, dims.height),
            ),
          );
          const isHeading =
            block.fontSize >= bodyFontSize * 1.25 && text.length <= 120;
          elements.push({
            id: `p${page}-e${elements.length}`,
            type: isHeading ? 'heading' : 'paragraph',
            text,
            location: { type: 'pdf', page, polygons },
            metadata: { fontSize: block.fontSize },
          });
        }
      }

      return {
        parserName: this.name,
        parserVersion: this.version,
        pageCount: document.numPages,
        pages,
        elements,
      };
    } finally {
      await loadingTask.destroy();
    }
  }
}
