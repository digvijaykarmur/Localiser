export class ModelContractFailure extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "MODEL_CONTRACT_FAILURE";
    this.raw = raw;
  }
}

export class CostEnvelopeExceeded extends Error {
  readonly recipeId: string;
  readonly total: number;
  readonly envelope: number;
  constructor(recipeId: string, total: number, envelope: number) {
    super(`cost envelope exceeded for ${recipeId}: ${total} > ${envelope}`);
    this.name = "CostEnvelopeExceeded";
    this.recipeId = recipeId;
    this.total = total;
    this.envelope = envelope;
  }
}

export class ReferentialEvidenceError extends Error {
  constructor(ids: string[]) {
    super(`unknown evidence_ids: ${ids.join(",")}`);
    this.name = "ReferentialEvidenceError";
  }
}
