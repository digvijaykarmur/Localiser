import { useEffect, useMemo, useState } from "react";
import { api, type Locale, type LocaleProgress, type TranslationEntry } from "./api";

export default function App() {
  const [locales, setLocales] = useState<Locale[]>([]);
  const [entries, setEntries] = useState<TranslationEntry[]>([]);
  const [progress, setProgress] = useState<LocaleProgress[]>([]);
  const [search, setSearch] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const [l, e, p] = await Promise.all([
      api.getLocales(),
      api.getEntries(),
      api.getProgress(),
    ]);
    setLocales(l);
    setEntries(e);
    setProgress(p);
  }

  useEffect(() => {
    refresh()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.key.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        Object.values(e.translations).some((v) => v.toLowerCase().includes(q)),
    );
  }, [entries, search]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.addEntry(newKey, newDescription);
      setNewKey("");
      setNewDescription("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleTranslationChange(key: string, code: string, value: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.key === key ? { ...e, translations: { ...e.translations, [code]: value } } : e,
      ),
    );
  }

  async function handleTranslationSave(key: string, code: string, value: string) {
    setError(null);
    try {
      await api.updateEntry(key, { translations: { [code]: value } });
      const p = await api.getProgress();
      setProgress(p);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(key: string) {
    setError(null);
    try {
      await api.deleteEntry(key);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo" aria-hidden>🌐</span>
          <div>
            <h1>Localiser</h1>
            <p className="subtitle">Manage your translation strings across locales</p>
          </div>
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <section className="progress-grid">
        {progress.map((p) => (
          <div className="progress-card" key={p.code}>
            <div className="progress-head">
              <span className="locale-code">{p.code.toUpperCase()}</span>
              <span className="locale-name">{p.name}</span>
            </div>
            <div className="progress-bar">
              <div
                className={`progress-fill ${p.percent === 100 ? "complete" : ""}`}
                style={{ width: `${p.percent}%` }}
              />
            </div>
            <div className="progress-meta">
              {p.translated}/{p.total} · {p.percent}%
            </div>
          </div>
        ))}
      </section>

      <section className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search keys, descriptions, or values…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="exports">
          {locales.map((l) => (
            <a
              key={l.code}
              className="export-btn"
              href={api.exportUrl(l.code)}
              download={`${l.code}.json`}
            >
              Export {l.code.toUpperCase()}
            </a>
          ))}
        </div>
      </section>

      <form className="add-form" onSubmit={handleAdd}>
        <input
          className="input key-input"
          placeholder="new.translation.key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <input
          className="input"
          placeholder="Description (optional)"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
        />
        <button type="submit" className="btn primary">
          Add key
        </button>
      </form>

      {loading ? (
        <p className="empty">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No matching keys.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="key-col">Key</th>
                {locales.map((l) => (
                  <th key={l.code}>{l.name}</th>
                ))}
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.key}>
                  <td className="key-col">
                    <div className="key-name">{entry.key}</div>
                    {entry.description && (
                      <div className="key-desc">{entry.description}</div>
                    )}
                  </td>
                  {locales.map((l) => {
                    const value = entry.translations[l.code] ?? "";
                    return (
                      <td key={l.code}>
                        <input
                          className={`cell ${value.trim() ? "" : "missing"}`}
                          value={value}
                          placeholder="—"
                          onChange={(e) =>
                            handleTranslationChange(entry.key, l.code, e.target.value)
                          }
                          onBlur={(e) =>
                            handleTranslationSave(entry.key, l.code, e.target.value)
                          }
                        />
                      </td>
                    );
                  })}
                  <td>
                    <button
                      className="btn danger"
                      onClick={() => handleDelete(entry.key)}
                      aria-label={`Delete ${entry.key}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
