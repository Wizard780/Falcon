import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
// Carlito has Calibri's metrics (SIL OFL), so Verbatim files wrap the same on machines without Office
import '@fontsource/carlito/400.css';
import '@fontsource/carlito/700.css';
import '@fontsource/carlito/400-italic.css';
import '@fontsource/carlito/700-italic.css';
import './styles.css';
import { bridge } from './editor/host';

if (bridge.platform) document.documentElement.classList.add('desktop', bridge.platform === 'darwin' ? 'mac' : 'win');

createRoot(document.getElementById('root')!).render(<App />);
