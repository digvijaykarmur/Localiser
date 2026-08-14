import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LocaliserData, LocaleProgress, TranslationEntry } from "./types.js";

const DEFAULT_DATA: LocaliserData = {
  locales: [
    { code: "en", name: "English" },
    { code: "es", name: "Spanish" },
    { code: "fr", name: "French" },
    { code: "de", name: "German" },
  ],
  entries: [
    {
      key: "app.title",
      description: "Main application title shown in the header",
      translations: { en: "Localiser", es: "Localiser", fr: "Localiser", de: "Localiser" },
    },
    {
      key: "nav.dashboard",
      description: "Sidebar link to the dashboard",
      translations: { en: "Dashboard", es: "Panel", fr: "Tableau de bord", de: "" },
    },
    {
      key: "action.save",
      description: "Label for the save button",
      translations: { en: "Save", es: "Guardar", fr: "", de: "Speichern" },
    },
    {
      key: "action.cancel",
      description: "Label for the cancel button",
      translations: { en: "Cancel", es: "", fr: "Annuler", de: "Abbrechen" },
    },
    {
      key: "greeting.welcome",
      description: "Welcome message on the landing page",
      translations: { en: "Welcome back!", es: "", fr: "", de: "" },
    },
  ],
};

/**
 * Simple JSON-file-backed store. Persistence keeps edits across dev-server
 * restarts; passing an in-memory store (no path) keeps tests isolated.
 */
export class Store {
  private data: LocaliserData;
  private readonly filePath: string | null;

  constructor(filePath: string | null) {
    this.filePath = filePath;
    this.data = this.load();
  }

  private load(): LocaliserData {
    if (this.filePath && existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, "utf-8");
        return JSON.parse(raw) as LocaliserData;
      } catch {
        // Fall back to defaults if the file is corrupt.
      }
    }
    return structuredClone(DEFAULT_DATA);
  }

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  getLocales() {
    return this.data.locales;
  }

  getEntries(): TranslationEntry[] {
    return this.data.entries;
  }

  getEntry(key: string): TranslationEntry | undefined {
    return this.data.entries.find((e) => e.key === key);
  }

  addEntry(key: string, description: string): TranslationEntry {
    if (!key || !key.trim()) {
      throw new ValidationError("Key is required");
    }
    if (this.getEntry(key)) {
      throw new ValidationError(`Key "${key}" already exists`);
    }
    const translations: Record<string, string> = {};
    for (const locale of this.data.locales) {
      translations[locale.code] = "";
    }
    const entry: TranslationEntry = { key: key.trim(), description: description ?? "", translations };
    this.data.entries.push(entry);
    this.persist();
    return entry;
  }

  updateEntry(
    key: string,
    updates: { description?: string; translations?: Record<string, string> },
  ): TranslationEntry {
    const entry = this.getEntry(key);
    if (!entry) {
      throw new NotFoundError(`Key "${key}" not found`);
    }
    if (typeof updates.description === "string") {
      entry.description = updates.description;
    }
    if (updates.translations) {
      const validCodes = new Set(this.data.locales.map((l) => l.code));
      for (const [code, value] of Object.entries(updates.translations)) {
        if (!validCodes.has(code)) {
          throw new ValidationError(`Unknown locale "${code}"`);
        }
        entry.translations[code] = value;
      }
    }
    this.persist();
    return entry;
  }

  deleteEntry(key: string): void {
    const idx = this.data.entries.findIndex((e) => e.key === key);
    if (idx === -1) {
      throw new NotFoundError(`Key "${key}" not found`);
    }
    this.data.entries.splice(idx, 1);
    this.persist();
  }

  getProgress(): LocaleProgress[] {
    const total = this.data.entries.length;
    return this.data.locales.map((locale) => {
      const translated = this.data.entries.filter(
        (e) => (e.translations[locale.code] ?? "").trim().length > 0,
      ).length;
      return {
        code: locale.code,
        name: locale.name,
        translated,
        total,
        percent: total === 0 ? 100 : Math.round((translated / total) * 100),
      };
    });
  }

  exportLocale(code: string): Record<string, string> {
    if (!this.data.locales.some((l) => l.code === code)) {
      throw new NotFoundError(`Unknown locale "${code}"`);
    }
    const result: Record<string, string> = {};
    for (const entry of this.data.entries) {
      result[entry.key] = entry.translations[code] ?? "";
    }
    return result;
  }
}

export class ValidationError extends Error {}
export class NotFoundError extends Error {}
