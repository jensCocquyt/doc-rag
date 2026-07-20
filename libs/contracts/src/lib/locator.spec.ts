import { chunkLocatorSchema, pdfLocatorSchema } from './locator';

const validLocator = {
  type: 'pdf',
  page: 12,
  polygons: [[0.12, 0.22, 0.74, 0.22, 0.74, 0.31, 0.12, 0.31]],
  excerpt: 'some cited text',
};

describe('pdfLocatorSchema', () => {
  it('accepts a valid locator', () => {
    expect(pdfLocatorSchema.parse(validLocator)).toEqual(validLocator);
  });

  it('rejects page zero', () => {
    expect(
      pdfLocatorSchema.safeParse({ ...validLocator, page: 0 }).success,
    ).toBe(false);
  });

  it('rejects an empty polygon list', () => {
    expect(
      pdfLocatorSchema.safeParse({ ...validLocator, polygons: [] }).success,
    ).toBe(false);
  });

  it('rejects coordinates outside the normalized 0..1 range', () => {
    const polygons = [[0.1, 0.2, 1.4, 0.2, 0.9, 0.3, 0.1, 0.3]];
    expect(
      pdfLocatorSchema.safeParse({ ...validLocator, polygons }).success,
    ).toBe(false);
  });

  it('rejects an odd number of polygon coordinates', () => {
    const polygons = [[0.1, 0.2, 0.9, 0.2, 0.9, 0.3, 0.1]];
    expect(
      pdfLocatorSchema.safeParse({ ...validLocator, polygons }).success,
    ).toBe(false);
  });

  it('rejects a missing excerpt', () => {
    expect(
      pdfLocatorSchema.safeParse({ ...validLocator, excerpt: '' }).success,
    ).toBe(false);
  });
});

describe('chunkLocatorSchema', () => {
  it('accepts a pdf locator through the union', () => {
    expect(chunkLocatorSchema.parse(validLocator)).toEqual(validLocator);
  });

  it('rejects unknown locator types', () => {
    expect(
      chunkLocatorSchema.safeParse({ ...validLocator, type: 'docx' }).success,
    ).toBe(false);
  });
});
