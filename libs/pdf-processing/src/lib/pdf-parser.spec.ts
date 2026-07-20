import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PageLimitExceededError } from '@doc-rag/document-processing';
import { PdfParser } from './pdf-parser';

async function buildFixturePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const page1 = doc.addPage([600, 800]);
  page1.drawText('Quarterly Report', { x: 50, y: 750, size: 24, font });
  page1.drawText('Revenue increased by 12 percent in the fourth quarter.', {
    x: 50,
    y: 700,
    size: 12,
    font,
  });
  page1.drawText('Operating costs remained flat year over year.', {
    x: 50,
    y: 680,
    size: 12,
    font,
  });

  const page2 = doc.addPage([600, 800]);
  page2.drawText('Outlook', { x: 50, y: 750, size: 24, font });
  page2.drawText('Growth is expected to continue into next year.', {
    x: 50,
    y: 700,
    size: 12,
    font,
  });

  return doc.save();
}

describe('PdfParser', () => {
  const parser = new PdfParser();

  it('extracts pages, ordered text, headings and normalized polygons', async () => {
    const pdf = await buildFixturePdf();
    const result = await parser.parse(pdf, { maxPages: 10 });

    expect(result.parserName).toBe('pdfjs-text');
    expect(result.pageCount).toBe(2);
    expect(result.pages).toEqual([
      { page: 1, width: 600, height: 800 },
      { page: 2, width: 600, height: 800 },
    ]);

    const texts = result.elements.map((e) => e.text);
    expect(texts).toContain('Quarterly Report');
    expect(
      texts.some((t) => t.includes('Revenue increased by 12 percent')),
    ).toBe(true);

    // Larger font → heading; body text → paragraph.
    const title = result.elements.find((e) => e.text === 'Quarterly Report');
    expect(title?.type).toBe('heading');
    const body = result.elements.find((e) =>
      e.text.includes('Revenue increased'),
    );
    expect(body?.type).toBe('paragraph');

    // Page assignment respects source pages.
    const outlook = result.elements.find((e) => e.text === 'Outlook');
    expect(outlook?.location.page).toBe(2);

    // Every polygon is normalized (0..1) with an even number of coordinates.
    for (const element of result.elements) {
      expect(element.location.polygons.length).toBeGreaterThan(0);
      for (const polygon of element.location.polygons) {
        expect(polygon.length % 2).toBe(0);
        expect(polygon.length).toBeGreaterThanOrEqual(6);
        for (const coordinate of polygon) {
          expect(coordinate).toBeGreaterThanOrEqual(0);
          expect(coordinate).toBeLessThanOrEqual(1);
        }
      }
    }

    // Title sits near the top of the page in top-left coordinates.
    const titleY = title!.location.polygons[0][1];
    expect(titleY).toBeLessThan(0.15);
  });

  it('is deterministic for identical input', async () => {
    const pdf = await buildFixturePdf();
    const first = await parser.parse(pdf, { maxPages: 10 });
    const second = await parser.parse(pdf, { maxPages: 10 });
    expect(second).toEqual(first);
  });

  it('enforces the page limit before extraction', async () => {
    const pdf = await buildFixturePdf();
    await expect(parser.parse(pdf, { maxPages: 1 })).rejects.toThrow(
      PageLimitExceededError,
    );
  });
});
