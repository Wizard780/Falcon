import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'preact/test-utils';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

function Broken(): never { throw new Error('something broke'); }

describe('ErrorBoundary', () => {
  it('shows the error and a Reload button instead of a blank window', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = document.body.appendChild(document.createElement('div'));
    await act(async () => { createRoot(el).render(createElement(ErrorBoundary, null, createElement(Broken))); });
    expect(el.textContent).toContain('something broke');
    expect(el.querySelector('button')?.textContent).toBe('Reload');
  });

  it('renders its children when nothing is wrong', async () => {
    const el = document.body.appendChild(document.createElement('div'));
    await act(async () => { createRoot(el).render(createElement(ErrorBoundary, null, createElement('p', null, 'fine'))); });
    expect(el.textContent).toBe('fine');
  });
});
