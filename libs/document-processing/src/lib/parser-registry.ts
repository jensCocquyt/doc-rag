import type { NormalizedDocument } from './normalized-document';

export interface DocumentParser {
  readonly name: string;
  readonly version: string;
  readonly mimeTypes: readonly string[];
  parse(content: Uint8Array, options: ParseOptions): Promise<NormalizedDocument>;
}

export interface ParseOptions {
  /** Parsing aborts with PageLimitExceededError beyond this. */
  maxPages: number;
}

export class PageLimitExceededError extends Error {
  constructor(
    readonly pageCount: number,
    readonly maxPages: number,
  ) {
    super(`Document has ${pageCount} pages; the limit is ${maxPages}`);
    this.name = 'PageLimitExceededError';
  }
}

export class UnsupportedMimeTypeError extends Error {
  constructor(readonly mimeType: string) {
    super(`No parser registered for MIME type '${mimeType}'`);
    this.name = 'UnsupportedMimeTypeError';
  }
}

/** MIME-keyed lookup; new file types plug in without touching the pipeline. */
export class ParserRegistry {
  private readonly parsers = new Map<string, DocumentParser>();

  register(parser: DocumentParser): void {
    for (const mimeType of parser.mimeTypes) {
      this.parsers.set(mimeType, parser);
    }
  }

  get(mimeType: string): DocumentParser {
    const parser = this.parsers.get(mimeType);
    if (!parser) {
      throw new UnsupportedMimeTypeError(mimeType);
    }
    return parser;
  }
}
