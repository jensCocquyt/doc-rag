import type { NormalizedDocument } from './normalized-document';
import {
  DocumentParser,
  ParserRegistry,
  UnsupportedMimeTypeError,
} from './parser-registry';

const stubParser = (mimeTypes: string[]): DocumentParser => ({
  name: 'stub',
  version: '1',
  mimeTypes,
  parse: async (): Promise<NormalizedDocument> => ({
    parserName: 'stub',
    parserVersion: '1',
    pageCount: 0,
    pages: [],
    elements: [],
  }),
});

describe('ParserRegistry', () => {
  it('resolves a parser by MIME type', () => {
    const registry = new ParserRegistry();
    const parser = stubParser(['application/pdf']);
    registry.register(parser);
    expect(registry.get('application/pdf')).toBe(parser);
  });

  it('throws UnsupportedMimeTypeError for unknown types', () => {
    const registry = new ParserRegistry();
    expect(() => registry.get('application/zip')).toThrow(
      UnsupportedMimeTypeError,
    );
  });
});
