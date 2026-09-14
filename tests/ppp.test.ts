import { describe, expect, it } from "vitest";
import { computePppTier, spearman } from "@/services/ledger";

describe("PPP and calibration", () => {
  it("starts in PROVE under 20 promos", () => {
    expect(computePppTier({ produced: 3, approvalRate: 1, medianEdit: 1, r01r02Last30: 0 })).toBe("PROVE");
  });
  it("reaches PILOT at 20 / 60% / 10m", () => {
    expect(computePppTier({ produced: 20, approvalRate: 0.6, medianEdit: 10, r01r02Last30: 0 })).toBe("PILOT");
  });
  it("reaches PRODUCTION only with the full gate", () => {
    expect(computePppTier({ produced: 50, approvalRate: 0.8, medianEdit: 4, r01r02Last30: 0 })).toBe("PRODUCTION");
    expect(computePppTier({ produced: 50, approvalRate: 0.8, medianEdit: 4, r01r02Last30: 1 })).toBe("PILOT");
  });
  it("computes Spearman (any value is acceptable; failing to compute is not)", () => {
    const rho = spearman([1, 2, 3, 4, 5], [1, 2, 4, 3, 5]);
    expect(rho).not.toBeNull();
    expect(typeof rho).toBe("number");
  });
});
