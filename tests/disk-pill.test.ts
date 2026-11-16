import { describe, expect, it } from 'vitest';
import { ago, cloudOf } from '../src/ui/DiskPill';

describe('the file pill', () => {
  it('names the cloud a file syncs through, from its folder', () => {
    expect(cloudOf('/Users/a/Dropbox/DA/Impact.docx')).toBe('Dropbox');
    expect(cloudOf('/Users/a/Library/CloudStorage/Dropbox-Team/DA/x.docx')).toBe('Dropbox');
    expect(cloudOf('/Users/a/Library/CloudStorage/OneDrive-Jericho/x.docx')).toBe('OneDrive');
    expect(cloudOf('/Users/a/Library/CloudStorage/GoogleDrive-a@b.com/My Drive/x.docx')).toBe('Google Drive');
    expect(cloudOf('/Users/a/Library/Mobile Documents/com~apple~CloudDocs/x.docx')).toBe('iCloud Drive');
    expect(cloudOf('C:\\Users\\a\\OneDrive\\Debate\\x.docx')).toBe('OneDrive');
    expect(cloudOf('/Users/a/Documents/Debate/x.docx')).toBeNull();
    // a file just named like a cloud isn't in one
    expect(cloudOf('/Users/a/Documents/Dropbox notes.docx')).toBeNull();
  });
  it('says how long ago, briefly', () => {
    const now = 1_000_000_000;
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 3 * 60_000, now)).toBe('3m ago');
    expect(ago(now - 2 * 3_600_000, now)).toBe('2h ago');
    expect(ago(now - 3 * 86_400_000, now)).toBe('3d ago');
  });
});
