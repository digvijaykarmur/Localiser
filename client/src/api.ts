export interface Locale {
  code: string;
  name: string;
}

export interface TranslationEntry {
  key: string;
  description: string;
  translations: Record<string, string>;
}

export interface LocaleProgress {
  code: string;
  name: string;
  translated: number;
  total: number;
  percent: number;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore parse failures
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  getLocales: () => fetch("/api/locales").then((r) => handle<Locale[]>(r)),
  getEntries: () => fetch("/api/entries").then((r) => handle<TranslationEntry[]>(r)),
  getProgress: () => fetch("/api/progress").then((r) => handle<LocaleProgress[]>(r)),
  addEntry: (key: string, description: string) =>
    fetch("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, description }),
    }).then((r) => handle<TranslationEntry>(r)),
  updateEntry: (
    key: string,
    updates: { description?: string; translations?: Record<string, string> },
  ) =>
    fetch(`/api/entries/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }).then((r) => handle<TranslationEntry>(r)),
  deleteEntry: (key: string) =>
    fetch(`/api/entries/${encodeURIComponent(key)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`Delete failed (${r.status})`);
    }),
  exportUrl: (code: string) => `/api/export/${encodeURIComponent(code)}`,
};
