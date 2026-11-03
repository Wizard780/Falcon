import type { Node as PMNode } from 'prosemirror-model';
import { bridge } from '../editor/host';
import { P, pref } from '../editor/prefs';

export type DocMeta = { name: string; path?: string };

/** Open a .docx: the native dialog in Electron, a file input on the web. */
export async function openDocument(): Promise<{ doc: PMNode; meta: DocMeta } | null> {
  let file: { name: string; path?: string; data: Uint8Array } | null;
  if (bridge.openFile) file = await bridge.openFile();
  else file = await pickFile();
  if (!file) return null;
  const doc = await (await import('../docx/import')).docxToDoc(file.data);
  return { doc, meta: { name: file.name.replace(/\.docx$/i, ''), path: file.path } };
}

/** Reopen a recent file by path (desktop only; the main process only allows files picked before). */
export async function openPath(path: string): Promise<{ doc: PMNode; meta: DocMeta }> {
  if (!bridge.openPath) throw new Error('Use Open to pick this file');
  const file = await bridge.openPath(path);
  const doc = await (await import('../docx/import')).docxToDoc(file.data);
  return { doc, meta: { name: file.name.replace(/\.docx$/i, ''), path: file.path } };
}

/** The name a never-saved Untitled doc is offered under, as Settings picks it. */
export function newFileName(how = pref(P.newName), now = new Date()): string {
  if (how === 'date') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (how === 'speech') return `Speech ${now.getMonth() + 1}-${now.getDate()} ${now.getHours() % 12 || 12}-${String(now.getMinutes()).padStart(2, '0')}${now.getHours() < 12 ? 'AM' : 'PM'}`;
  return 'Untitled';
}

export async function saveDocument(doc: PMNode, meta: DocMeta, saveAs: boolean): Promise<DocMeta | null> {
  const data = await (await import('../docx/export')).docToDocx(doc);
  const untitled = !meta.path && (meta.name || 'Untitled') === 'Untitled';
  const name = `${untitled ? newFileName() : meta.name}.docx`;
  if (bridge.saveFile) {
    const r = await bridge.saveFile({ path: saveAs ? undefined : meta.path, name, data });
    return r ? { name: r.name.replace(/\.docx$/i, ''), path: r.path } : null;
  }
  const blob = new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return untitled ? { ...meta, name: name.replace(/\.docx$/, '') } : meta;
}

function pickFile(): Promise<{ name: string; data: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.click();
  });
}
