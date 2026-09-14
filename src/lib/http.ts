import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export function jsonOk<T>(schema: ZodType<T>, data: unknown, status = 200) {
  const parsed = schema.parse(data);
  return NextResponse.json(parsed, { status });
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const body = await req.json();
  return schema.parse(body);
}
