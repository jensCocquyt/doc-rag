import { useEffect, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { CitationDto } from '@doc-rag/contracts';
import { getPreviewUrl } from '../documents/api-client';
import { polygonToRect } from './geometry';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

// Same-version worker as react-pdf's bundled pdfjs (root dependency pinned
// to react-pdf's requirement).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const RENDER_WIDTH = 560;

export interface PdfViewerProps {
  citation: CitationDto;
  onClose: () => void;
}

export function PdfViewer({ citation, onClose }: PdfViewerProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pageAspect, setPageAspect] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPreviewUrl(null);
    setError(null);
    getPreviewUrl(citation.documentId)
      .then((preview) => setPreviewUrl(preview.url))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [citation.documentId]);

  const renderedHeight = pageAspect ? RENDER_WIDTH * pageAspect : null;
  const highlights = useMemo(
    () =>
      renderedHeight
        ? citation.polygons.map((polygon) =>
            polygonToRect(polygon, RENDER_WIDTH, renderedHeight),
          )
        : [],
    [citation.polygons, renderedHeight],
  );

  return (
    <aside
      aria-label="pdf viewer"
      style={{
        borderLeft: '1px solid #ddd',
        paddingLeft: '1rem',
        width: RENDER_WIDTH + 20,
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <div>
          <strong>{citation.fileName}</strong> — page {citation.page}
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <blockquote style={{ fontStyle: 'italic', color: '#555' }}>
        “{citation.excerpt}”
      </blockquote>
      {error && <p role="alert">{error}</p>}
      {previewUrl && (
        <div style={{ position: 'relative' }} data-testid="pdf-page-container">
          <Document
            file={previewUrl}
            loading={<p>Loading document…</p>}
            error={<p role="alert">Could not load the PDF.</p>}
          >
            <Page
              pageNumber={citation.page}
              width={RENDER_WIDTH}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onLoadSuccess={(page) => {
                const viewport = page.getViewport({ scale: 1 });
                setPageAspect(viewport.height / viewport.width);
              }}
            />
          </Document>
          {highlights.map((rect, index) => (
            <div
              key={index}
              data-testid="citation-highlight"
              style={{
                position: 'absolute',
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                background: 'rgba(255, 213, 0, 0.4)',
                outline: '1px solid rgba(255, 170, 0, 0.9)',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
