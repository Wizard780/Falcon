/** localStorage.setItem that survives a full or blocked store: the value just isn't kept. Throwing from an effect would unmount the app. */
export function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* QuotaExceededError, or storage turned off */ }
}

/** A JSON value from localStorage, or `fallback` when the key is missing or its text won't parse (a write cut off by a crash). */
export function readJson<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback; } catch { return fallback; }
}
