/** Every failure is legible: it names the thing that failed and what to do (§13). */
export type ErrorCode =
  | "MODEL_CONTRACT_FAILURE"
  | "COST_ENVELOPE_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_QUOTA"
  | "RENDER_FAILURE"
  | "INSUFFICIENT_EVIDENCE"
  | "EVIDENCE_REFERENCE"
  | "SPINE_VIOLATION"
  | "WORD_BUDGET"
  | "DIALECT_AVOID_WORD"
  | "MISSING_BINARY"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "VALIDATION"
  | "ASSUMPTION_VIOLATED";

export class PromoError extends Error {
  readonly code: ErrorCode;
  readonly detail: Record<string, unknown>;
  readonly recovery: string;
  readonly retryable: boolean;
  constructor(code: ErrorCode, message: string, opts: { detail?: Record<string, unknown>; recovery?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = "PromoError";
    this.code = code;
    this.detail = opts.detail ?? {};
    this.recovery = opts.recovery ?? "";
    this.retryable = opts.retryable ?? false;
  }
  toJSON() {
    return { code: this.code, message: this.message, detail: this.detail, recovery: this.recovery, retryable: this.retryable };
  }
}

export class CostEnvelopeExceeded extends PromoError {
  constructor(recipeId: string, spent: number, envelope: number, item: string, amount: number) {
    super(
      "COST_ENVELOPE_EXCEEDED",
      `Cost envelope exceeded: ₹${(spent + amount).toFixed(2)} would exceed ₹${envelope.toFixed(2)} on ${item}.`,
      {
        detail: { recipe_id: recipeId, spent_inr: spent, envelope_inr: envelope, item, amount_inr: amount },
        recovery: "Raise the envelope on a new recipe, or change format.",
      },
    );
  }
}

export class ModelContractFailure extends PromoError {
  constructor(stage: string, promptVersion: string, rawStorageKey: string | null, lastError: string) {
    super("MODEL_CONTRACT_FAILURE", `The ${stage} model could not produce a valid ${stage} after 3 attempts. Raw output saved.`, {
      detail: { stage, prompt_version: promptVersion, raw_storage_key: rawStorageKey, last_error: lastError },
      recovery: `Retry from ${stage.toUpperCase()}; if persistent, it is a prompt bug in ${promptVersion}.`,
    });
  }
}

export class ProviderUnavailable extends PromoError {
  constructor(provider: string, cause: string, quotaResetHint?: string) {
    super(quotaResetHint ? "PROVIDER_QUOTA" : "PROVIDER_UNAVAILABLE", `${provider}: ${cause}${quotaResetHint ? ` ${quotaResetHint}` : ""}`, {
      detail: { provider, cause },
      recovery: "Job holds in WAITING_PROVIDER and resumes automatically. Manual retry available.",
      retryable: true,
    });
  }
}

export function toErrorJSON(e: unknown): { code: ErrorCode; message: string; detail: Record<string, unknown>; recovery: string; retryable: boolean } {
  if (e instanceof PromoError) return e.toJSON();
  const msg = e instanceof Error ? e.message : String(e);
  return { code: "VALIDATION", message: msg, detail: { stack: e instanceof Error ? e.stack : undefined }, recovery: "", retryable: false };
}
