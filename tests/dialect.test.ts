import { describe, expect, it } from "vitest";
import { dialectAliases, mapDialect } from "@/lib/dialect";

describe("mapDialect", () => {
  it("maps Antaryami/ClickHouse har to engine hry", () => {
    expect(mapDialect("har")).toBe("hry");
    expect(mapDialect("hariyanvi")).toBe("hry");
    expect(mapDialect("Haryanvi")).toBe("hry");
    expect(mapDialect("hry")).toBe("hry");
  });

  it("maps the other six catalogue dialects", () => {
    expect(mapDialect("raj")).toBe("raj");
    expect(mapDialect("bho")).toBe("bho");
    expect(mapDialect("guj")).toBe("guj");
    expect(mapDialect("mar")).toBe("mar");
    expect(mapDialect("ben")).toBe("ben");
    expect(mapDialect("bangla")).toBe("ben");
  });

  it("returns null for unknown codes", () => {
    expect(mapDialect("en")).toBeNull();
    expect(mapDialect("")).toBeNull();
  });

  it("lists aliases used to filter the live catalogue", () => {
    const aliases = dialectAliases("hry");
    expect(aliases).toEqual(expect.arrayContaining(["har", "hry", "haryanvi"]));
  });
});
