import { describe, expect, it } from "vitest";
import { Timeline } from "@/domain";
import { filtergraphSnapshot } from "@/services/composer/filtergraph";
import fs from "node:fs";
import path from "node:path";

function load(name: string) {
  const p = path.resolve(process.cwd(), "tests/fixtures", name);
  return Timeline.parse(JSON.parse(fs.readFileSync(p, "utf8")));
}

function golden(name: string, args: string[]) {
  const p = path.resolve(process.cwd(), "tests/golden", name);
  if (process.env.UPDATE_GOLDEN === "1") {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(args, null, 2));
  }
  const expected = JSON.parse(fs.readFileSync(p, "utf8")) as string[];
  expect(args).toEqual(expected);
}

describe("filtergraph golden files", () => {
  it("16:9 native single clip", () => {
    golden("tl_169_native.json", filtergraphSnapshot(load("tl_169_native.json")));
  });
  it("9:16 caption-dominant", () => {
    golden("tl_916_caption.json", filtergraphSnapshot(load("tl_916_caption.json")));
  });
  it("9:16 stacked with crop keyframes", () => {
    golden("tl_916_stacked.json", filtergraphSnapshot(load("tl_916_stacked.json")));
  });
  it("is byte-stable across two runs", () => {
    const a = filtergraphSnapshot(load("tl_916_caption.json"));
    const b = filtergraphSnapshot(load("tl_916_caption.json"));
    expect(a).toEqual(b);
  });
});
