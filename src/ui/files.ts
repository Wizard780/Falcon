import type { Node as PMNode } from 'prosemirror-model';
import { bridge } from '../editor/host';
import { P, pref } from '../editor/prefs';
import { trimSoon } from './quiet';

export type DocMeta = { name: string; path?: string };

/** Open a .docx: the native dialog in Electron, a file input on the web. */
export async function openDocument(): Promise<{ doc: PMNode; meta: DocMeta } | null> {
  let file: { name: string; path?: string; data: Uint8Array } | null;
  if (bridge.openFile) file = await bridge.openFile();
  else file = await pickFile();
  if (!file) return null;
  const doc = await (await import('../docx/import')).docxToDoc(file.data);
  trimSoon(); // the import's leftovers: the zip, the XML text, the parse
  return { doc, meta: { name: file.name.replace(/\.docx$/i, ''), path: file.path } };
}

/** Reopen a recent file by path (desktop only; the main process only allows files picked before). */
export async function openPath(path: string): Promise<{ doc: PMNode; meta: DocMeta }> {
  if (!bridge.openPath) throw new Error('Use Open to pick this file');
  const file = await bridge.openPath(path);
  const doc = await (await import('../docx/import')).docxToDoc(file.data);
  trimSoon(); // the import's leftovers: the zip, the XML text, the parse
  return { doc, meta: { name: file.name.replace(/\.docx$/i, ''), path: file.path } };
}

/** The name a never-saved Untitled doc is offered under, as Settings picks it. */
export function newFileName(how = pref(P.newName), now = new Date()): string {
  if (how === 'date') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (how === 'speech') return `Speech ${now.getMonth() + 1}-${now.getDate()} ${now.getHours() % 12 || 12}-${String(now.getMinutes()).padStart(2, '0')}${now.getHours() < 12 ? 'AM' : 'PM'}`;
  return 'Untitled';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

/** `{date:…}` written out: YYYY YY, M MM MMM MMMM, D DD ddd dddd, h hh H HH, m mm, s ss, A a; `[text]` stays as typed. */
export function formatDate(fmt: string, d = new Date()): string {
  const h12 = d.getHours() % 12 || 12, pm = d.getHours() >= 12;
  const t: Record<string, string> = {
    YYYY: String(d.getFullYear()), YY: pad(d.getFullYear() % 100),
    MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: pad(d.getMonth() + 1), M: String(d.getMonth() + 1),
    dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3), DD: pad(d.getDate()), D: String(d.getDate()),
    HH: pad(d.getHours()), H: String(d.getHours()), hh: pad(h12), h: String(h12),
    mm: pad(d.getMinutes()), m: String(d.getMinutes()), ss: pad(d.getSeconds()), s: String(d.getSeconds()),
    A: pm ? 'PM' : 'AM', a: pm ? 'pm' : 'am',
  };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|m|ss|s|A|a/g, (k, lit?: string) => lit ?? t[k]);
}

/** A new speech doc's file name, from Settings' template: `{speech}` is the name typed at the prompt. */
export function speechFileName(speech: string, template = pref(P.speechName), now = new Date()): string {
  const name = template.replace(/\{speech\}|\{date:([^}]*)\}/g, (_, f?: string) => (f === undefined ? speech.trim() : formatDate(f, now)))
    .replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return name || speech.trim() || 'Speech';
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
