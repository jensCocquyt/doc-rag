CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536),
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "chunks"."content")) STORED,
	"heading_context" text,
	"locator" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_documents" (
	"conversation_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	CONSTRAINT "conversation_documents_conversation_id_document_id_pk" PRIMARY KEY("conversation_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"content_hash" text,
	"parser_version" text,
	"normalized_artifact_key" text,
	"page_count" integer,
	"worksheet_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_hash" text,
	"status" text DEFAULT 'uploading' NOT NULL,
	"active_version_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_citations" (
	"message_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"citation_number" integer NOT NULL,
	CONSTRAINT "message_citations_message_id_chunk_id_pk" PRIMARY KEY("message_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_identity_id" text,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_documents" ADD CONSTRAINT "conversation_documents_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_documents" ADD CONSTRAINT "conversation_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_search_vector_idx" ON "chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "chunks_tenant_document_idx" ON "chunks" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "chunks_document_version_idx" ON "chunks" USING btree ("document_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_version_sequence_idx" ON "chunks" USING btree ("document_version_id","sequence");--> statement-breakpoint
CREATE INDEX "conversations_tenant_user_idx" ON "conversations" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_version_idx" ON "document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_status_idx" ON "documents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_jobs_idempotency_idx" ON "ingestion_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ingestion_jobs_version_idx" ON "ingestion_jobs" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_idx" ON "users" USING btree ("tenant_id","email");