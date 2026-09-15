import type { CropKeyframe } from "@/domain";

/** Format a number for an ffmpeg expression: integers stay integers; others trimmed to ≤4 dp. */
export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10000) / 10000);
}

/**
 * Piecewise-linear interpolation of crop keyframes as an ffmpeg time expression (§24.1 step 4).
 *   [(0,200),(1000,200),(2500,320)] on x →
 *   if(lt(t,1), 200, if(lt(t,2.5), 200+(t-1)*80, 320))
 * Generated programmatically. Never written by a model.
 */
export function keyframesToExpr(keyframes: CropKeyframe[], axis: "x" | "y"): string {
  if (keyframes.length === 0) throw new Error("keyframesToExpr: no keyframes");
  const kfs = [...keyframes].sort((a, b) => a.t_ms - b.t_ms);
  const val = (k: CropKeyframe) => k.box[axis];
  if (kfs.length === 1) return fmtNum(val(kfs[0]!));

  const build = (i: number): string => {
    const a = kfs[i]!;
    const b = kfs[i + 1];
    if (!b) return fmtNum(val(a));
    const t0 = a.t_ms / 1000;
    const t1 = b.t_ms / 1000;
    const v0 = val(a);
    const v1 = val(b);
    let seg: string;
    if (v1 === v0 || t1 === t0) seg = fmtNum(v0);
    else {
      const slope = (v1 - v0) / (t1 - t0);
      seg = `${fmtNum(v0)}${slope >= 0 ? "+" : "-"}(t-${fmtNum(t0)})*${fmtNum(Math.abs(slope))}`;
    }
    return `if(lt(t,${fmtNum(t1)}), ${seg}, ${build(i + 1)})`;
  };
  return build(0);
}

/** A crop filter string for either a static crop or a tracked crop with keyframes. */
export function cropFilter(box: { w: number; h: number }, keyframes: CropKeyframe[] | null, staticBox: { x: number; y: number } | null): string {
  if (keyframes && keyframes.length) return `crop=${box.w}:${box.h}:'${keyframesToExpr(keyframes, "x")}':'${keyframesToExpr(keyframes, "y")}'`;
  if (staticBox) return `crop=${box.w}:${box.h}:${staticBox.x}:${staticBox.y}`;
  throw new Error("cropFilter: neither keyframes nor static box");
}
