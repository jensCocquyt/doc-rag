import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentDto } from '@doc-rag/contracts';
import {
  completeUpload,
  createUploadSession,
  deleteDocument,
  listDocuments,
  retryDocument,
  uploadToStorage,
} from './api-client';

interface UploadItem {
  key: string;
  fileName: string;
  /** 0-100 while PUTting to Blob Storage. */
  progress: number;
  phase: 'requesting' | 'uploading' | 'finalizing' | 'done' | 'error';
  error?: string;
}

const POLL_INTERVAL_MS = 4000;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await listDocuments());
      setListError(null);
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const patchUpload = (key: string, patch: Partial<UploadItem>) => {
    setUploads((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const uploadOne = async (file: File, key: string) => {
    try {
      const session = await createUploadSession(file);
      patchUpload(key, { phase: 'uploading' });
      await uploadToStorage(session, file, (progress) =>
        patchUpload(key, { progress }),
      );
      patchUpload(key, { phase: 'finalizing', progress: 100 });
      await completeUpload(session.documentId);
      patchUpload(key, { phase: 'done' });
      await refresh();
    } catch (error) {
      patchUpload(key, {
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onFilesSelected = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((current) => [
        ...current,
        { key, fileName: file.name, progress: 0, phase: 'requesting' },
      ]);
      void uploadOne(file, key);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onDelete = async (id: string) => {
    try {
      await deleteDocument(id);
      await refresh();
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  };

  const onRetry = async (id: string) => {
    try {
      await retryDocument(id);
      await refresh();
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>Documents</h1>

      <section>
        <label>
          Upload PDF files
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={(event) => onFilesSelected(event.target.files)}
            style={{ display: 'block', margin: '0.5rem 0 1rem' }}
          />
        </label>
      </section>

      {uploads.length > 0 && (
        <section aria-label="uploads">
          <h2>Uploads</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {uploads.map((upload) => (
              <li key={upload.key} style={{ marginBottom: '0.5rem' }}>
                <strong>{upload.fileName}</strong>{' '}
                {upload.phase === 'uploading' && (
                  <progress value={upload.progress} max={100} />
                )}
                <span> {upload.phase === 'error' ? upload.error : upload.phase}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="documents">
        <h2>Library</h2>
        {listError && <p role="alert">{listError}</p>}
        {documents.length === 0 && !listError && <p>No documents yet.</p>}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '0.4rem 0' }}>{doc.fileName}</td>
                <td>{formatSize(doc.sizeBytes)}</td>
                <td>
                  <code>{doc.status}</code>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {doc.status === 'failed' && (
                    <button type="button" onClick={() => void onRetry(doc.id)}>
                      Retry
                    </button>
                  )}{' '}
                  <button type="button" onClick={() => void onDelete(doc.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

export default DocumentsPage;
