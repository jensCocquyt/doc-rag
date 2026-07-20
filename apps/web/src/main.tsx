import { StrictMode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import * as ReactDOM from 'react-dom/client';
import App from './app/app';
import { ensureSignedIn } from './app/auth/auth';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

// No-op in poc mode; in entra mode redirects to login before rendering.
void ensureSignedIn().then(() => {
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
