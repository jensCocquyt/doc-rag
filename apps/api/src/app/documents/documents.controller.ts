import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  uploadSessionRequestSchema,
  type DocumentDto,
  type DocumentListResponse,
  type PreviewUrlResponse,
  type UploadSessionResponse,
} from '@doc-rag/contracts';
import { Identity, type RequestIdentity } from '../auth/auth.guard';
import { DocumentsService } from './documents.service';
import { parseBody } from './zod-body.pipe';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload-sessions')
  async createUploadSession(
    @Identity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<UploadSessionResponse> {
    const request = parseBody(uploadSessionRequestSchema, body);
    return this.documentsService.createUploadSession(identity, request);
  }

  @Post(':id/complete-upload')
  @HttpCode(200)
  async completeUpload(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentDto> {
    return this.documentsService.completeUpload(identity, id);
  }

  @Get()
  async list(
    @Identity() identity: RequestIdentity,
  ): Promise<DocumentListResponse> {
    return { documents: await this.documentsService.list(identity) };
  }

  @Get(':id/preview-url')
  async previewUrl(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PreviewUrlResponse> {
    return this.documentsService.createPreviewUrl(identity, id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  async retry(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentDto> {
    return this.documentsService.retry(identity, id);
  }

  @Get(':id')
  async get(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentDto> {
    return this.documentsService.get(identity, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.documentsService.softDelete(identity, id);
  }
}
