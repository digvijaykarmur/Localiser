export interface Locale {
  code: string;
  name: string;
}

export interface TranslationEntry {
  key: string;
  description: string;
  translations: Record<string, string>;
}

export interface LocaliserData {
  locales: Locale[];
  entries: TranslationEntry[];
}

export interface LocaleProgress {
  code: string;
  name: string;
  translated: number;
  total: number;
  percent: number;
}
