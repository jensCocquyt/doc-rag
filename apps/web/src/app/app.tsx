import { Route, Routes } from 'react-router-dom';
import DocumentsPage from './documents/documents-page';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<DocumentsPage />} />
    </Routes>
  );
}

export default App;
