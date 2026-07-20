import { uploadSessionRequestSchema } from './documents';

describe('uploadSessionRequestSchema', () => {
  const valid = {
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
  };

  it('accepts a valid PDF upload request', () => {
    expect(uploadSessionRequestSchema.parse(valid)).toEqual(valid);
  });

  it('accepts an uppercase .PDF extension', () => {
    expect(
      uploadSessionRequestSchema.safeParse({ ...valid, fileName: 'A.PDF' })
        .success,
    ).toBe(true);
  });

  it.each([
    ['non-pdf extension', { ...valid, fileName: 'report.docx' }],
    ['missing extension', { ...valid, fileName: 'report' }],
    ['path traversal', { ...valid, fileName: '../evil.pdf' }],
    ['backslash path', { ...valid, fileName: 'a\\evil.pdf' }],
    ['empty name', { ...valid, fileName: '' }],
    ['overlong name', { ...valid, fileName: `${'a'.repeat(255)}.pdf` }],
    ['wrong mime type', { ...valid, mimeType: 'application/zip' }],
    ['zero size', { ...valid, sizeBytes: 0 }],
    ['negative size', { ...valid, sizeBytes: -5 }],
    ['fractional size', { ...valid, sizeBytes: 10.5 }],
  ])('rejects %s', (_label, input) => {
    expect(uploadSessionRequestSchema.safeParse(input).success).toBe(false);
  });
});
