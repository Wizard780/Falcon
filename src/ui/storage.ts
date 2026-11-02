/** localStorage.setItem that survives a full or blocked store: the value just isn't kept. Throwing from an effect would unmount the app. */
export function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* QuotaExceededError, or storage turned off */ }
}
