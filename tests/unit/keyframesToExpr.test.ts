import { describe, expect, it } from "vitest";
import { cropFilter, fmtNum, keyframesToExpr } from "@/services/composer";

const kf = (t_ms: number, x: number, y = 0) => ({ t_ms, box: { x, y, w: 608, h: 1080 } });

describe("keyframesToExpr (§24.1 step 4)", () => {
  it("matches the documented example: hold, ramp, hold", () => {
    expect(keyframesToExpr([kf(0, 200), kf(1000, 200), kf(2500, 320)], "x")).toBe("if(lt(t,1), 200, if(lt(t,2.5), 200+(t-1)*80, 320))");
  });
  it("single keyframe is a constant", () => {
    expect(keyframesToExpr([kf(0, 656)], "x")).toBe("656");
    expect(keyframesToExpr([kf(0, 656)], "y")).toBe("0");
  });
  it("two identical keyframes collapse to a constant inside one if()", () => {
    expect(keyframesToExpr([kf(0, 272), kf(3000, 272)], "x")).toBe("if(lt(t,3), 272, 272)");
  });
  it("negative slope is emitted with a minus", () => {
    expect(keyframesToExpr([kf(0, 400), kf(2000, 200)], "x")).toBe("if(lt(t,2), 400-(t-0)*100, 200)");
  });
  it("sorts unordered keyframes", () => {
    expect(keyframesToExpr([kf(2500, 320), kf(0, 200), kf(1000, 200)], "x")).toBe("if(lt(t,1), 200, if(lt(t,2.5), 200+(t-1)*80, 320))");
  });
  it("throws on empty", () => {
    expect(() => keyframesToExpr([], "x")).toThrow();
  });
  it("fmtNum trims floats", () => {
    expect(fmtNum(1)).toBe("1");
    expect(fmtNum(1.23456789)).toBe("1.2346");
    expect(fmtNum(0.1 + 0.2)).toBe("0.3");
  });
  it("cropFilter emits static or tracked crop", () => {
    expect(cropFilter({ w: 608, h: 1080 }, null, { x: 656, y: 0 })).toBe("crop=608:1080:656:0");
    expect(cropFilter({ w: 608, h: 1080 }, [kf(0, 200), kf(1000, 300)], null)).toBe("crop=608:1080:'if(lt(t,1), 200+(t-0)*100, 300)':'if(lt(t,1), 0, 0)'");
  });
});
