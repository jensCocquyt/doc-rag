/**
 * Normalized extraction model (PLAN.md §7). Parsers produce these elements;
 * chunking, debugging and future reindexing consume them. Stored as a JSON
 * artifact separate from embeddings so chunking/embedding changes never
 * require reparsing the original file.
 */

/** Flat x,y pairs normalized 0..1 against page dimensions, top-left origin. */
export type NormalizedPolygon = number[];

export interface PdfSourceLocation {
  type: 'pdf';
  /** 1-based. */
  page: number;
  polygons: NormalizedPolygon[];
}

/** Widens to a union when XLSX support lands (worksheet + cell range). */
export type SourceLocation = PdfSourceLocation;

export type NormalizedElementType =
  | 'heading'
  | 'paragraph'
  | 'table'
  | 'spreadsheet-range';

export interface NormalizedDocumentElement {
  id: string;
  type: NormalizedElementType;
  text: string;
  location: SourceLocation;
  metadata: Record<string, unknown>;
}

/** The versioned artifact persisted per document version. */
export interface NormalizedDocument {
  parserName: string;
  parserVersion: string;
  pageCount: number;
  /** Per-page dimensions in PDF units; polygons are normalized against these. */
  pages: { page: number; width: number; height: number }[];
  elements: NormalizedDocumentElement[];
}
