import { z } from 'zod';
import { documentStatusSchema } from './domain';

/**
 * Upload metadata the client declares before receiving an upload URL.
 * PDF-only for the POC; the allowlists widen when XLSX support lands.
 * The size ceiling (MAX_FILE_SIZE_BYTES) is configuration, so the API
 * enforces it separately from this schema.
 */
export const uploadSessionRequestSchema = z.object({
  fileName: z
    .string()
    .min(1)
    .max(255)
    .refine((name) => !/[/\\]/.test(name), 'file name must not contain paths')
    .refine((name) => /\.pdf$/i.test(name), 'only .pdf files are supported'),
  mimeType: z.literal('application/pdf'),
  sizeBytes: z.number().int().positive(),
});
export type UploadSessionRequest = z.infer<typeof uploadSessionRequestSchema>;

export const uploadSessionResponseSchema = z.object({
  documentId: z.uuid(),
  uploadUrl: z.url(),
  /** Headers the browser must send on the PUT to Blob Storage. */
  uploadHeaders: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export type UploadSessionResponse = z.infer<typeof uploadSessionResponseSchema>;

export const documentDtoSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: documentStatusSchema,
  createdAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime(),
});
export type DocumentDto = z.infer<typeof documentDtoSchema>;

export const documentListResponseSchema = z.object({
  documents: z.array(documentDtoSchema),
});
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;

export const previewUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type PreviewUrlResponse = z.infer<typeof previewUrlResponseSchema>;
