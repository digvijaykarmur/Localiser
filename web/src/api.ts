/** Typed API client for the FastAPI backend on :8420 (proxied via /api). */

export type SeriesCard = {
  id: string;
  title: string;
  title_hi: string | null;
  chapters: number;
  pages: number;
  percent_complete: number;
  bible_locked: boolean;
  rights_status: string;
  cover_page_id: string | null;
};

export type RegionT = {
  id: string;
  ordinal: number;
  kind: string;
  bbox: [number, number, number, number];
  polygon: number[][] | null;
  src_text: string | null;
  src_script: string | null;
  target_text: string | null;
  target_locked: boolean;
  speaker_id: string | null;
  speaker_conf: number | null;
  clean_tier: number | null;
  clean_risk: number | null;
  status: string;
  confidence: number | null;
  source: string | null;
  render: Record<string, unknown> | null;
};

export type PageT = {
  id: string;
  state: string;
  version: number;
  width: number;
  height: number;
  flagged: boolean;
  regions: RegionT[];
};

export type ChapterT = {
  id: string;
  number: number;
  title_src: string | null;
  title_hi: string | null;
  state: string;
  story_words: number;
  page_count: number;
  page_states: Record<string, number>;
};

export type NoteT = {
  id: string;
  page_id: string;
  region_id: string | null;
  x: number;
  y: number;
  body: string;
  status: string;
};

export type OpCard = {
  op: string;
  args: Record<string, unknown>;
  needs_confirm: boolean;
  blast_radius?: string;
  explain_hi?: string;
};

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

export const api = {
  listSeries: () => fetch("/api/series").then((r) => j<SeriesCard[]>(r)),
  getSeries: (id: string) => fetch(`/api/series/${id}`).then((r) => j<any>(r)),
  createSeries: (body: object) => post("/api/series", body).then((r) => j<any>(r)),

  getBible: (id: string) => fetch(`/api/series/${id}/bible`).then((r) => j<any>(r)),
  putBible: (id: string, bible: object) =>
    fetch(`/api/series/${id}/bible`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bible),
    }).then((r) => j<any>(r)),
  lockBible: (id: string) => post(`/api/series/${id}/bible/lock`).then((r) => j<any>(r)),
  bibleInbox: (id: string) => fetch(`/api/series/${id}/bible/inbox`).then((r) => j<any>(r)),
  inboxAction: (id: string, item: string, action: "accept" | "reject") =>
    post(`/api/series/${id}/bible/inbox/${item}/${action}`).then((r) => j<any>(r)),
  registerPreview: (id: string, character_id: string, sample_text: string) =>
    post(`/api/series/${id}/bible/preview`, { character_id, sample_text }).then((r) => j<any>(r)),

  listChapters: (seriesId: string) =>
    fetch(`/api/chapters?series_id=${seriesId}`).then((r) => j<ChapterT[]>(r)),
  runChapter: (chapterId: string, stages: string[], confirm: boolean) =>
    post(`/api/chapters/${chapterId}/run`, { stages, confirm_cost: confirm }).then((r) => j<any>(r)),
  getStory: (chapterId: string) =>
    fetch(`/api/chapters/${chapterId}/story`).then((r) => j<any>(r)),
  regenStory: (chapterId: string, hint?: string) =>
    post(`/api/chapters/${chapterId}/story/regen`, { hint }).then((r) => j<any>(r)),

  getPage: (pageId: string) => fetch(`/api/pages/${pageId}`).then((r) => j<PageT>(r)),
  pageImageUrl: (pageId: string, which: string, v?: number) =>
    `/api/pages/${pageId}/image/${which}${v ? `?v=${v}` : ""}`,
  patchRegion: (regionId: string, body: object) =>
    fetch(`/api/regions/${regionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<any>(r)),
  retranslate: (regionId: string, hint?: string) =>
    post(`/api/regions/${regionId}/retranslate`, { hint }).then((r) => j<any>(r)),
  approvePage: (pageId: string) => post(`/api/pages/${pageId}/approve`).then((r) => j<any>(r)),
  rebuildPage: (pageId: string) => post(`/api/pages/${pageId}/rebuild`).then((r) => j<any>(r)),

  listNotes: (pageId: string) =>
    fetch(`/api/notes?page_id=${encodeURIComponent(pageId)}`).then((r) => j<NoteT[]>(r)),
  createNote: (body: object) => post("/api/notes", body).then((r) => j<any>(r)),
  noteAction: (id: string, action: "apply" | "reject" | "resolve") =>
    post(`/api/notes/${id}/${action}`).then((r) => j<any>(r)),

  chat: (scope: string, scope_id: string, message: string, selected_region?: string | null) =>
    post("/api/chat", { scope, scope_id, message, selected_region }).then(
      (r) => j<{ ops: OpCard[] }>(r)
    ),
  applyOps: (series_id: string, ops: OpCard[]) =>
    post("/api/ops/apply", { series_id, ops }).then((r) => j<any>(r)),

  exportBlockers: (seriesId: string) =>
    fetch(`/api/export/blockers?series_id=${seriesId}`).then((r) => j<any>(r)),
  exportSeries: (series_id: string, options: object) =>
    post("/api/export", { series_id, options }).then((r) => j<any>(r)),
  cost: () => fetch("/api/cost").then((r) => j<any>(r)),
  jobStatus: (id: string) => fetch(`/api/jobs/${id}`).then((r) => j<any>(r)),
};

export function subscribeJob(jobId: string, onEvent: (e: any) => void): () => void {
  const es = new EventSource(`/api/jobs/${jobId}/events`);
  es.onmessage = (m) => {
    const data = JSON.parse(m.data);
    onEvent(data);
    if (data.type === "end") es.close();
  };
  es.onerror = () => es.close();
  return () => es.close();
}
