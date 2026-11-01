import type { Node as PMNode } from 'prosemirror-model';
import { bridge } from '../editor/host';
import { docxToDoc } from '../docx/import';
import { docToDocx } from '../docx/export';

export type DocMeta = { name: string; path?: string };

/** Open a .docx: the native dialog in Electron, a file input on the web. */
export async function openDocument(): Promise<{ doc: PMNode; meta: DocMeta } | null> {
  let file: { name: string; path?: string; data: Uint8Array } | null;
  if (bridge.openFile) file = await bridge.openFile();
  else file = await pickFile();
  if (!file) return null;
  const doc = await docxToDoc(file.data);
  return { doc, meta: { name: file.name.replace(/\.docx$/i, ''), path: file.path } };
}

export async function saveDocument(doc: PMNode, meta: DocMeta, saveAs: boolean): Promise<DocMeta | null> {
  const data = await docToDocx(doc);
  const name = `${meta.name || 'Untitled'}.docx`;
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
  return meta;
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
