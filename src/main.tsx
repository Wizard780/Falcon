import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';
import { bridge } from './editor/host';

if (bridge.platform) document.documentElement.classList.add('desktop', bridge.platform === 'darwin' ? 'mac' : 'win');

createRoot(document.getElementById('root')!).render(<App />);
