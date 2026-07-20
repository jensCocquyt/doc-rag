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
import { DocumentsService } from './documents.service';
import { parseBody } from './zod-body.pipe';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload-sessions')
  async createUploadSession(
    @Body() body: unknown,
  ): Promise<UploadSessionResponse> {
    const request = parseBody(uploadSessionRequestSchema, body);
    return this.documentsService.createUploadSession(request);
  }

  @Post(':id/complete-upload')
  @HttpCode(200)
  async completeUpload(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentDto> {
    return this.documentsService.completeUpload(id);
  }

  @Get()
  async list(): Promise<DocumentListResponse> {
    return { documents: await this.documentsService.list() };
  }

  @Get(':id/preview-url')
  async previewUrl(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PreviewUrlResponse> {
    return this.documentsService.createPreviewUrl(id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  async retry(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentDto> {
    return this.documentsService.retry(id);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentDto> {
    return this.documentsService.get(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.documentsService.softDelete(id);
  }
}
