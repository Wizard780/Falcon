import { bridge } from '../editor/host';
import { P, pref } from '../editor/prefs';

export type DocSource = 'dialog' | 'recent' | 'search' | 'os' | 'restore';

/** Count a feature use, unless Settings > General > Share usage statistics is off. Desktop app only. */
export function track(event: 'app_opened' | 'doc_new' | 'doc_opened' | 'doc_saved', props?: Record<string, string | number | boolean>) {
  if (pref(P.usageStats)) bridge.track?.(event, props);
}
