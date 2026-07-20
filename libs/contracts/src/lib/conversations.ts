import { z } from 'zod';
import { messageRoleSchema, messageStatusSchema } from './domain';

export const createConversationRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;

export const conversationDtoSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  /** Explicit narrowing selection; empty = whole tenant corpus. */
  documentIds: z.array(z.uuid()),
  createdAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime(),
});
export type ConversationDto = z.infer<typeof conversationDtoSchema>;

export const updateConversationDocumentsRequestSchema = z.object({
  /** Replaces the selection wholesale; [] restores whole-corpus scope. */
  documentIds: z.array(z.uuid()).max(100),
});
export type UpdateConversationDocumentsRequest = z.infer<
  typeof updateConversationDocumentsRequestSchema
>;

export const postMessageRequestSchema = z.object({
  content: z.string().min(1).max(4000),
});
export type PostMessageRequest = z.infer<typeof postMessageRequestSchema>;

/** Safe citation metadata — resolved from the database, never from the model. */
export const citationDtoSchema = z.object({
  citationNumber: z.number().int().min(1),
  chunkId: z.uuid(),
  documentId: z.uuid(),
  fileName: z.string(),
  page: z.number().int().min(1),
  excerpt: z.string(),
});
export type CitationDto = z.infer<typeof citationDtoSchema>;

export const answerSegmentDtoSchema = z.object({
  text: z.string(),
  citationNumbers: z.array(z.number().int().min(1)),
});
export type AnswerSegmentDto = z.infer<typeof answerSegmentDtoSchema>;

export const messageDtoSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  role: messageRoleSchema,
  content: z.string(),
  status: messageStatusSchema,
  segments: z.array(answerSegmentDtoSchema).optional(),
  citations: z.array(citationDtoSchema).optional(),
  createdAt: z.iso.datetime(),
});
export type MessageDto = z.infer<typeof messageDtoSchema>;

/**
 * NDJSON events streamed while an answer is generated. The client renders
 * text deltas immediately; citations arrive as typed data (never parsed out
 * of model text).
 */
export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message-start'),
    messageId: z.uuid(),
    /** Cancellation handle: POST .../generations/:generationId/cancel */
    generationId: z.uuid(),
  }),
  z.object({
    type: z.literal('segment-delta'),
    segmentIndex: z.number().int().min(0),
    text: z.string(),
  }),
  z.object({
    type: z.literal('segment-complete'),
    segmentIndex: z.number().int().min(0),
    citations: z.array(citationDtoSchema),
  }),
  z.object({
    type: z.literal('message-complete'),
    message: messageDtoSchema,
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

/**
 * The structured output contract for the answering model (PLAN.md §8):
 * segments citing opaque ids from the supplied evidence; anything else fails
 * backend validation.
 */
export const modelAnswerSchema = z.object({
  segments: z.array(
    z.object({
      text: z.string(),
      citationIds: z.array(z.string()),
    }),
  ),
  insufficientEvidence: z.boolean(),
});
export type ModelAnswer = z.infer<typeof modelAnswerSchema>;
