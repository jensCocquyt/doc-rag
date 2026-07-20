import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import App from './app';

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          documents: [
            {
              id: '00000000-0000-4000-8000-000000000003',
              fileName: 'seed-sample.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 12345,
              status: 'ready',
              createdAt: '2026-01-01T00:00:00.000Z',
              modifiedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the documents page with the upload control', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Upload PDF files/i)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('seed-sample.pdf')).toBeTruthy(),
    );
  });
});
