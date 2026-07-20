import { z } from 'zod';

/**
 * Source locator persisted on every chunk (PLAN.md §5). PDF-only for now; a
 * discriminated union gains an XLSX member when spreadsheet support lands.
 * Polygon coordinates are normalized against page dimensions (0..1) so
 * highlights survive any render scale.
 */
const normalizedCoordinate = z.number().min(0).max(1);

// One polygon = flat list of x,y pairs; a rectangle is 4 points = 8 numbers.
export const pdfPolygonSchema = z
  .array(normalizedCoordinate)
  .min(6)
  .refine((points) => points.length % 2 === 0, {
    message: 'polygon must contain an even number of coordinates (x,y pairs)',
  });

export const pdfLocatorSchema = z.object({
  type: z.literal('pdf'),
  page: z.number().int().min(1),
  polygons: z.array(pdfPolygonSchema).min(1),
  excerpt: z.string().min(1),
});

export const chunkLocatorSchema = z.discriminatedUnion('type', [
  pdfLocatorSchema,
]);

export type PdfLocator = z.infer<typeof pdfLocatorSchema>;
export type ChunkLocator = z.infer<typeof chunkLocatorSchema>;
