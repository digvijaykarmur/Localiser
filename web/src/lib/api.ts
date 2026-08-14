const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export const api = {
  health: () => req<{ ok: boolean; models: Record<string, string> }>("/health"),
  listSeries: () => req<any[]>("/series"),
  createSeries: (body: any) => req("/series", { method: "POST", body: JSON.stringify(body) }),
  getSeries: (id: string) => req<any>(`/series/${id}`),
  getBible: (id: string) => req<any>(`/series/${id}/bible`),
  putBible: (id: string, bible: any) =>
    req(`/series/${id}/bible`, { method: "PUT", body: JSON.stringify(bible) }),
  lockBible: (id: string) => req(`/series/${id}/bible/lock`, { method: "POST" }),
  biblePreview: (id: string, character_id: string, sample_text: string) =>
    req(`/series/${id}/bible/preview`, {
      method: "POST",
      body: JSON.stringify({ character_id, sample_text }),
    }),
  bibleInbox: (id: string) => req<any[]>(`/series/${id}/bible/inbox`),
  chapters: (seriesId: string) => req<any[]>(`/chapters?series_id=${seriesId}`),
  runChapter: (chapterId: string, stages: string[], confirm_cost = false) =>
    req(`/chapters/${encodeURIComponent(chapterId)}/run`, {
      method: "POST",
      body: JSON.stringify({ stages, confirm_cost }),
    }),
  getPage: (pageId: string) => req<any>(`/pages/${pageId}`),
  patchRegion: (regionId: string, body: any) =>
    req(`/regions/${regionId}`, { method: "PATCH", body: JSON.stringify(body) }),
  approvePage: (pageId: string) =>
    req(`/pages/${pageId}/approve`, { method: "POST" }),
  rebuildPage: (pageId: string) =>
    req(`/pages/${pageId}/rebuild`, { method: "POST" }),
  notes: (pageId: string) => req<any[]>(`/notes?page_id=${encodeURIComponent(pageId)}`),
  createNote: (body: any) => req("/notes", { method: "POST", body: JSON.stringify(body) }),
  chat: (body: any) => req("/chat", { method: "POST", body: JSON.stringify(body) }),
  applyOps: (ops: any[]) =>
    req("/ops/apply", { method: "POST", body: JSON.stringify({ ops }) }),
  story: (chapterId: string) =>
    req<any>(`/chapters/${encodeURIComponent(chapterId)}/story`),
  exportBlockers: (seriesId: string) =>
    req<any[]>(`/export/blockers?series_id=${seriesId}`),
  exportSeries: (body: any) =>
    req("/export", { method: "POST", body: JSON.stringify(body) }),
  cost: (seriesId: string) => req<any>(`/cost?series_id=${seriesId}`),
  imageUrl: (pageId: string, kind: string) => `/api/pages/${pageId}/image/${kind}`,
};
