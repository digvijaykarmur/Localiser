"use client";

export interface ApiError {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
  recovery?: string;
}

export class ApiFailure extends Error {
  constructor(public readonly error: ApiError, public readonly status: number) {
    super(error.message);
  }
}

/** Client fetch wrapper: JSON in, JSON out, server error bodies surfaced verbatim (§13). */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiFailure((body as ApiError) ?? { code: "HTTP", message: `${res.status} ${res.statusText}` }, res.status);
  return body as T;
}

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₹${Math.round(n * 100) / 100}`);
export const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`);
export const ms = (v: number) => `${String(Math.floor(v / 60000)).padStart(2, "0")}:${String(Math.floor((v % 60000) / 1000)).padStart(2, "0")}`;
