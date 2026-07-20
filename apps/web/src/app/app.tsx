import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Routes } from 'react-router-dom';
import ChatPage from './chat/chat-page';
import DocumentsPage from './documents/documents-page';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1rem' }}>
        <nav
          role="navigation"
          style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}
        >
          <Link to="/">Documents</Link>
          <Link to="/chat">Chat</Link>
        </nav>
        <Routes>
          <Route path="/" element={<DocumentsPage />} />
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </div>
    </QueryClientProvider>
  );
}

export default App;
