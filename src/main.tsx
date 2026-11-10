import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
// Carlito has Calibri's metrics (SIL OFL), so Verbatim files wrap the same on machines without Office
import '@fontsource/carlito/400.css';
import '@fontsource/carlito/700.css';
import '@fontsource/carlito/400-italic.css';
import '@fontsource/carlito/700-italic.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/inter';
import '@fontsource-variable/figtree';
import './ui/fonts/fonts.css';
import './styles.css';
import { bridge } from './editor/host';
import { installQuiet } from './ui/quiet';

if (bridge.platform) document.documentElement.classList.add('desktop', bridge.platform === 'darwin' ? 'mac' : 'win');

installQuiet(); // the caret stops blinking when nothing's happening (see quiet.ts)

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
