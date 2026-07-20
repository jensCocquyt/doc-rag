import type { NormalizedDocumentElement } from '@doc-rag/document-processing';
import { approximateTokenCount, chunkElements } from './chunker';

const rect = [0.1, 0.1, 0.9, 0.1, 0.9, 0.2, 0.1, 0.2];

function element(
  overrides: Partial<NormalizedDocumentElement> & { text: string },
): NormalizedDocumentElement {
  return {
    id: overrides.id ?? 'e',
    type: overrides.type ?? 'paragraph',
    text: overrides.text,
    location: overrides.location ?? { type: 'pdf', page: 1, polygons: [rect] },
    metadata: {},
  };
}

const options = { targetTokens: 100, overlapTokens: 15 };

describe('chunkElements', () => {
  it('groups small elements of one page into one chunk', () => {
    const chunks = chunkElements(
      [
        element({ text: 'First paragraph.' }),
        element({ text: 'Second paragraph.' }),
      ],
      options,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('First paragraph.\nSecond paragraph.');
    expect(chunks[0].sequence).toBe(0);
    expect(chunks[0].locator.page).toBe(1);
    expect(chunks[0].locator.polygons).toHaveLength(2);
    expect(chunks[0].locator.excerpt.length).toBeGreaterThan(0);
  });

  it('never crosses page boundaries', () => {
    const chunks = chunkElements(
      [
        element({ text: 'Page one text.' }),
        element({
          text: 'Page two text.',
          location: { type: 'pdf', page: 2, polygons: [rect] },
        }),
      ],
      options,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0].locator.page).toBe(1);
    expect(chunks[1].locator.page).toBe(2);
  });

  it('flushes when the target token budget would be exceeded', () => {
    const long = 'word '.repeat(90).trim(); // ~112 tokens
    const chunks = chunkElements(
      [element({ text: long }), element({ text: long })],
      { targetTokens: 150, overlapTokens: 15 },
    );
    expect(chunks).toHaveLength(2);
  });

  it('starts a new chunk at headings and records heading context', () => {
    const chunks = chunkElements(
      [
        element({ text: 'Intro before any heading.' }),
        element({ text: 'Results', type: 'heading' }),
        element({ text: 'Revenue increased.' }),
      ],
      options,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingContext).toBeUndefined();
    expect(chunks[1].content).toBe('Results\nRevenue increased.');
    expect(chunks[1].headingContext).toBe('Results');
  });

  it('splits an over-long element by sentence with overlap', () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `Sentence number ${i} carries some measurable content.`,
    ).join(' ');
    const chunks = chunkElements([element({ text: sentences })], {
      targetTokens: 80,
      overlapTokens: 20,
    });
    expect(chunks.length).toBeGreaterThan(2);
    // Overlap: each piece starts with a sentence that also ends the previous
    // piece (the carried-over overlap).
    const firstSentenceOfSecond = chunks[1].content.match(/^[^.]+\./)?.[0];
    expect(firstSentenceOfSecond).toBeDefined();
    expect(chunks[0].content.endsWith(firstSentenceOfSecond!.trim())).toBe(
      true,
    );
    for (const chunk of chunks) {
      expect(chunk.locator.page).toBe(1);
    }
  });

  it('produces identical hashes and sequences for identical input', () => {
    const input = [
      element({ text: 'Alpha.' }),
      element({ text: 'Heading', type: 'heading' }),
      element({ text: 'Beta.' }),
    ];
    const first = chunkElements(input, options);
    const second = chunkElements(input, options);
    expect(second).toEqual(first);
    expect(first[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('approximateTokenCount', () => {
  it('approximates at ~4 characters per token and never returns zero', () => {
    expect(approximateTokenCount('')).toBe(1);
    expect(approximateTokenCount('abcdefgh')).toBe(2);
  });
});
