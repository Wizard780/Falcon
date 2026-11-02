import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { ago, releaseNotes } from '../src/ui/update';

const { newer, assetFor, sumFor } = createRequire(import.meta.url)('../electron/updater.cjs');

const BODY = `**Install**
- **Mac (Apple silicon):** open the .dmg and drag Falcon onto Applications.
- **Windows:** run \`Falcon-Setup-0.1.2.exe\`.

## Added
- **Tables, pictures and footnotes** open, edit and save in .docx files.
  - Tables: resize columns by dragging.
- **Save As** (⇧⌘S) has four kinds:
- Plain bullet with \`code\`

## Fixed
- **Relaunching** no longer opens an empty tab.

## Notes
- Hat underlines no longer break.

SHA-256 checksums are in SHA256SUMS.txt.`;

describe('update card', () => {
  it('takes the top-level changes, skipping Install and sub-bullets', () => {
    const { items, more } = releaseNotes(BODY);
    expect(items).toEqual([
      { lead: 'Tables, pictures and footnotes', rest: 'open, edit and save in .docx files.' },
      { lead: 'Save As', rest: '(⇧⌘S) has four kinds:' },
      { lead: '', rest: 'Plain bullet with code' },
    ]);
    expect(more).toBe(2);
  });
  it('handles empty notes', () => expect(releaseNotes('')).toEqual({ items: [], more: 0 }));
  it('says how long ago', () => {
    const now = Date.parse('2026-11-02T20:00:00Z');
    expect(ago('2026-11-02T19:59:40Z', now)).toBe('just now');
    expect(ago('2026-11-02T19:15:00Z', now)).toBe('45m ago');
    expect(ago('2026-11-02T18:00:00Z', now)).toBe('2h ago');
    expect(ago('2026-10-30T20:00:00Z', now)).toBe('3d ago');
    expect(ago('nope', now)).toBe('');
  });
});

describe('updater', () => {
  it('compares versions numerically', () => {
    expect(newer('v0.1.10', '0.1.9')).toBe(true);
    expect(newer('0.2.0', '0.1.99')).toBe(true);
    expect(newer('v0.1.3', '0.1.3')).toBe(false);
    expect(newer('0.1.2', '0.1.3')).toBe(false);
  });
  it('reads the checksum for exactly this file', () => {
    const sums = `aaa  Falcon-0.1.4-arm64.dmg\nBBB *Falcon-Setup-0.1.4.exe\nccc  old-Falcon-Setup-0.1.4.exe\n`;
    expect(sumFor(sums, 'Falcon-0.1.4-arm64.dmg')).toBe('aaa');
    expect(sumFor(sums, 'Falcon-Setup-0.1.4.exe')).toBe('bbb');
    expect(sumFor('ccc  old-Falcon-Setup-0.1.4.exe', 'Falcon-Setup-0.1.4.exe')).toBeNull();
  });
  it('picks the installer for this machine', () => {
    const assets = [{ name: 'Falcon-0.1.4-arm64.dmg' }, { name: 'Falcon-Setup-0.1.4.exe' }, { name: 'SHA256SUMS.txt' }];
    expect(assetFor(assets, 'darwin', 'arm64').name).toBe('Falcon-0.1.4-arm64.dmg');
    expect(assetFor(assets, 'darwin', 'x64')).toBeUndefined();
    expect(assetFor(assets, 'win32', 'x64').name).toBe('Falcon-Setup-0.1.4.exe');
    expect(assetFor(assets, 'linux', 'x64')).toBeUndefined();
  });
});
