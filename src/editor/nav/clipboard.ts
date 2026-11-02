import { DOMSerializer, type Slice } from 'prosemirror-model';
import { schema } from '../schema';

/**
 * Put paragraphs on the clipboard as HTML (which Falcon pastes back with styles intact) and plain text.
 * Resolves true once the copy has landed, so Cut can remove the original only then.
 */
export async function copySlice(slice: Slice): Promise<boolean> {
  const div = document.createElement('div');
  div.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(slice.content));
  const html = div.innerHTML;
  const text = slice.content.textBetween(0, slice.content.size, '\n');
  // a copy event we fill ourselves: works from any key or click, with no permission prompt
  let ok = false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
    e.stopImmediatePropagation(); // the editor's own copy handler would put its selection there instead
    ok = true;
  };
  window.addEventListener('copy', onCopy, true);
  try { document.execCommand('copy'); } catch { /* fall back below */ } finally { window.removeEventListener('copy', onCopy, true); }
  if (ok) return true;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    return true;
  } catch { return false; }
}
