import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Timeline } from "@/domain";
import { timelineToArgs } from "@/services/composer";
import { ASSETS, T11, T169, T916 } from "./fixtures";

const dir = path.resolve(__dirname);
const UPDATE = process.env.UPDATE_GOLDEN === "1";

function check(name: string, t: Timeline) {
  Timeline.parse(t);
  const args = timelineToArgs(t, ASSETS, { out: `/out/${name}.mp4`, promoId: "pr_golden" });
  const file = path.join(dir, `${name}.golden.json`);
  if (UPDATE || !fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(args, null, 2) + "\n");
  const expected = JSON.parse(fs.readFileSync(file, "utf8")) as string[];
  expect(args).toEqual(expected);
  return args;
}

describe("golden filtergraphs (§24.2, acceptance 12)", () => {
  it("16:9 timeline → snapshot", () => {
    const args = check("t169", T169);
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("sidechaincompress");
    expect(fc).toContain("amix=inputs=5");
    expect(args).toContain("comment=promo_id=pr_golden");
    expect(args.slice(-1)[0]).toBe("/out/t169.mp4");
  });
  it("9:16 timeline → snapshot with a tracked crop expression", () => {
    const args = check("t916", T916);
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("crop=608:1080:'if(lt(t,1), 200, if(lt(t,2.5), 200+(t-1)*80, if(lt(t,3), 320, 320)))'");
    expect(fc).toContain("scale=1080:608");
    expect(fc).toContain("overlay=0:220");
  });
  it("1:1 timeline → snapshot with stacked presenter and static crop", () => {
    const args = check("t11", T11);
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("crop=1080:732:0:210");
    expect(fc).toContain("crop=1080:1080:420:0");
    expect(fc).toContain("colorchannelmixer=aa=0.9");
  });
  it("same Timeline in → byte-identical args out (acceptance 5)", () => {
    const a = JSON.stringify(timelineToArgs(T916, ASSETS, { out: "/o.mp4", promoId: "p" }));
    const b = JSON.stringify(timelineToArgs(structuredClone(T916), new Map(ASSETS), { out: "/o.mp4", promoId: "p" }));
    expect(a).toBe(b);
  });
  it("layer order is by z then id, independent of input order", () => {
    const shuffled = { ...T169, layers: [...T169.layers].reverse() };
    expect(timelineToArgs(shuffled, ASSETS, { out: "/o.mp4", promoId: "p" })).toEqual(timelineToArgs(T169, ASSETS, { out: "/o.mp4", promoId: "p" }));
  });
  it("output encode settings are pinned", () => {
    const args = timelineToArgs(T169, ASSETS, { out: "/o.mp4", promoId: "p" });
    const s = args.join(" ");
    expect(s).toContain("-c:v libx264 -crf 19 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k");
    expect(s).toContain("-r 30 -movflags +faststart");
  });
  it("fails loudly on an unresolved asset", () => {
    expect(() => timelineToArgs(T169, new Map(), { out: "/o.mp4", promoId: "p" })).toThrow(/not resolved/);
  });
});
