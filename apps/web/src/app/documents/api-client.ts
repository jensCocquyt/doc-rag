import type {
  DocumentDto,
  DocumentListResponse,
  PreviewUrlResponse,
  UploadSessionResponse,
} from '@doc-rag/contracts';

/**
 * Thin fetch client for the documents API. Paths are relative: the Vite dev
 * server proxies /documents to the API (vite.config.mts); in Azure the web
 * container serves behind the same origin or an equivalent ingress rule.
 */

async function parseError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { message?: string };
    return new Error(body.message ?? `Request failed (${response.status})`);
  } catch {
    return new Error(`Request failed (${response.status})`);
  }
}

export async function createUploadSession(
  file: File,
): Promise<UploadSessionResponse> {
  const response = await fetch('/documents/upload-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/pdf',
      sizeBytes: file.size,
    }),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as UploadSessionResponse;
}

/**
 * PUTs the file straight to Blob Storage with the scoped SAS URL. XHR instead
 * of fetch because fetch has no upload-progress events.
 */
export function uploadToStorage(
  session: UploadSessionResponse,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', session.uploadUrl);
    for (const [name, value] of Object.entries(session.uploadHeaders)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Storage upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Storage upload failed (network)'));
    xhr.send(file);
  });
}

export async function completeUpload(documentId: string): Promise<DocumentDto> {
  const response = await fetch(`/documents/${documentId}/complete-upload`, {
    method: 'POST',
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as DocumentDto;
}

export async function listDocuments(): Promise<DocumentDto[]> {
  const response = await fetch('/documents');
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as DocumentListResponse;
  return body.documents;
}

export async function deleteDocument(documentId: string): Promise<void> {
  const response = await fetch(`/documents/${documentId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw await parseError(response);
}

export async function retryDocument(documentId: string): Promise<DocumentDto> {
  const response = await fetch(`/documents/${documentId}/retry`, {
    method: 'POST',
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as DocumentDto;
}

export async function getPreviewUrl(
  documentId: string,
): Promise<PreviewUrlResponse> {
  const response = await fetch(`/documents/${documentId}/preview-url`);
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as PreviewUrlResponse;
}
