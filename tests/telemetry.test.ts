import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

// electron/telemetry.cjs with a fake Electron app, so the payload PostHog would get can be read
const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'falcon-telemetry-'));
const app = { isPackaged: true, getVersion: () => '9.9.9', getPath: () => dir };
require.cache[require.resolve('electron')] = { exports: { app } } as never;
const telemetry = require('../electron/telemetry.cjs');

afterEach(() => vi.unstubAllGlobals());

test('sends a known event with only short word properties, under one install id', () => {
  const fetch = vi.fn(() => Promise.resolve(new Response()));
  vi.stubGlobal('fetch', fetch);
  telemetry.track('doc_opened', { source: 'recent', save_as: true, name: 'Smith 24 Aff.docx', text: 'nuclear war causes extinction', Bad: 'x' });
  telemetry.track('doc_saved', { mode: 'asis' });
  expect(fetch).toHaveBeenCalledTimes(2);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://us.i.posthog.com/i/v0/e/');
  const body = JSON.parse(init.body as string);
  expect(body.event).toBe('doc_opened');
  expect(body.properties).toMatchObject({ source: 'recent', save_as: true, app_version: '9.9.9', $process_person_profile: false, $geoip_disable: true });
  expect(body.properties).not.toHaveProperty('name');
  expect(body.properties).not.toHaveProperty('text');
  expect(body.properties).not.toHaveProperty('Bad');
  const second = JSON.parse((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
  expect(second.distinct_id).toBe(body.distinct_id);
  expect(readFileSync(join(dir, 'telemetry-id'), 'utf8')).toBe(body.distinct_id);
});

test('drops events it does not know', () => {
  const fetch = vi.fn(() => Promise.resolve(new Response()));
  vi.stubGlobal('fetch', fetch);
  telemetry.track('clipboard_contents', { text: 'secret' });
  expect(fetch).not.toHaveBeenCalled();
});

test('stays off in dev, tests and unpackaged runs', () => {
  expect(telemetry.enabled({ dev: true, headless: false })).toBe(false);
  expect(telemetry.enabled({ dev: false, headless: true })).toBe(false);
  app.isPackaged = false;
  expect(telemetry.enabled({ dev: false, headless: false })).toBe(false);
});
