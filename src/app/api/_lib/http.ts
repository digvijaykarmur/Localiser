import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { PromoError, type ErrorCode } from "@/domain";

const STATUS: Partial<Record<ErrorCode, number>> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  INSUFFICIENT_EVIDENCE: 422,
  INVALID_TRANSITION: 409,
  COST_ENVELOPE_EXCEEDED: 402,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_QUOTA: 503,
  MISSING_BINARY: 500,
  ASSUMPTION_VIOLATED: 500,
};

/** Outbound responses are Zod-validated as well as inbound (§27) when a schema is given. */
export function ok<S extends z.ZodTypeAny>(data: z.input<S>, schema?: S, init?: ResponseInit): NextResponse {
  const body = schema ? schema.parse(data) : data;
  return NextResponse.json(body, init);
}

/** Every error names the thing that failed and what to do (§13). Never "something went wrong". */
export function fail(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    return NextResponse.json(
      { code: "VALIDATION", message: `Request body invalid: ${e.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("; ")}`, detail: { issues: e.issues }, recovery: "Fix the listed fields and resend." },
      { status: 400 },
    );
  }
  if (e instanceof PromoError) return NextResponse.json(e.toJSON(), { status: STATUS[e.code] ?? 400 });
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ code: "INTERNAL", message: msg, detail: {}, recovery: "Check the server log for the stack trace." }, { status: 500 });
}

export async function readJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const raw = await req.json().catch(() => {
    throw new PromoError("VALIDATION", "Request body is not JSON.");
  });
  return schema.parse(raw);
}

export type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<NextResponse>;

export function route(fn: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return fail(e);
    }
  };
}

export const dynamic = "force-dynamic";
