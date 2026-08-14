import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type Series = {
  id: string;
  title: string;
  title_hi?: string;
  format: "page" | "longstrip";
  reading_dir: "ltr" | "rtl";
  bible_locked: boolean;
  chapter_count: number;
  page_count: number;
  cover_page_id?: string;
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed (${response.status})`);
  }
  return response.json();
}

export function App() {
  const client = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const series = useQuery({
    queryKey: ["series"],
    queryFn: () => api<Series[]>("/api/series"),
  });
  const create = useMutation({
    mutationFn: (payload: Record<string, FormDataEntryValue>) =>
      api("/api/series", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["series"] });
      setShowAdd(false);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    create.mutate(values);
  }

  return (
    <main>
      <header className="masthead">
        <div className="brand-mark" aria-hidden="true">ロ</div>
        <div>
          <p className="eyebrow">ArTribe Toons · Manga Workshop</p>
          <h1>Localiser</h1>
        </div>
        <div className="header-rule" />
        <button className="primary" onClick={() => setShowAdd(true)}>
          <span>＋</span> Add series
        </button>
      </header>

      <section className="library">
        <div className="section-title">
          <div>
            <p className="eyebrow">Your workbench</p>
            <h2>Series Library</h2>
          </div>
          <p className="local-badge"><i /> Local workspace</p>
        </div>

        {series.isLoading && <p className="empty">Opening the workshop…</p>}
        {series.isError && (
          <p className="error">Backend नहीं मिला। पहले <code>localiser serve</code> चलाएँ।</p>
        )}
        {series.data?.length === 0 && (
          <button className="empty-workbench" onClick={() => setShowAdd(true)}>
            <span className="registration">＋</span>
            <strong>No series yet</strong>
            <span>अपना पहला manga folder जोड़कर शुरू करें</span>
          </button>
        )}
        <div className="series-grid">
          {series.data?.map((item, index) => (
            <article className="series-card" key={item.id}>
              <div className="cover">
                <img
                  src={`/api/pages/${item.cover_page_id}/image/original`}
                  alt=""
                  onError={(event) => (event.currentTarget.style.display = "none")}
                />
                <span className="chapter-stamp">{item.chapter_count} CH</span>
                <span className="folio">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div className="card-copy">
                <h3>{item.title}</h3>
                <p className="hindi">{item.title_hi || "हिंदी शीर्षक बाकी है"}</p>
                <div className="metadata">
                  <span>{item.page_count} pages</span>
                  <span>{item.format}</span>
                  <span>{item.reading_dir.toUpperCase()}</span>
                </div>
                <div className={`bible ${item.bible_locked ? "locked" : ""}`}>
                  <span>{item.bible_locked ? "◆" : "◇"}</span>
                  Bible {item.bible_locked ? "locked" : "needs review"}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {showAdd && (
        <div className="modal-backdrop" onMouseDown={() => setShowAdd(false)}>
          <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setShowAdd(false)} aria-label="Close">×</button>
            <p className="eyebrow">New work · 新作</p>
            <h2>Add a series</h2>
            <p className="modal-note">Source files read-only रहेंगे। Localiser उनकी local copies पर काम करेगा।</p>
            <form onSubmit={submit}>
              <label>Series title<input name="title" required placeholder="Estate Developer" /></label>
              <label>Hindi title<input name="title_hi" placeholder="एस्टेट डेवलपर" /></label>
              <label>Folder path<input name="input_path" required placeholder="/Users/you/Manga/Series" /></label>
              <div className="form-row">
                <label>Reading direction
                  <select name="reading_dir" defaultValue="ltr">
                    <option value="ltr">Left to right</option>
                    <option value="rtl">Right to left</option>
                  </select>
                </label>
                <label>Format
                  <select name="format" defaultValue="page">
                    <option value="page">Pages</option>
                    <option value="longstrip">Long-strip</option>
                  </select>
                </label>
              </div>
              {create.error && <p className="error">{create.error.message}</p>}
              <button className="primary submit" disabled={create.isPending}>
                {create.isPending ? "Importing…" : "Set on workbench →"}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
