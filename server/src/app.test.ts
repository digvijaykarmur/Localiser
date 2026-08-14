import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { Store } from "./store.js";

function makeApp() {
  // null path => in-memory store seeded with defaults, isolated per test.
  return createApp(new Store(null));
}

describe("Localiser API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = makeApp();
  });

  it("reports health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("returns seeded locales", async () => {
    const res = await request(app).get("/api/locales");
    expect(res.status).toBe(200);
    expect(res.body.map((l: { code: string }) => l.code)).toEqual(["en", "es", "fr", "de"]);
  });

  it("computes translation progress", async () => {
    const res = await request(app).get("/api/progress");
    expect(res.status).toBe(200);
    const en = res.body.find((p: { code: string }) => p.code === "en");
    expect(en.percent).toBe(100);
    const de = res.body.find((p: { code: string }) => p.code === "de");
    expect(de.percent).toBeLessThan(100);
  });

  it("creates a new entry", async () => {
    const res = await request(app)
      .post("/api/entries")
      .send({ key: "action.delete", description: "Delete button" });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe("action.delete");
    expect(res.body.translations).toHaveProperty("en", "");

    const list = await request(app).get("/api/entries");
    expect(list.body.some((e: { key: string }) => e.key === "action.delete")).toBe(true);
  });

  it("rejects duplicate keys", async () => {
    const res = await request(app).post("/api/entries").send({ key: "app.title" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/);
  });

  it("rejects empty keys", async () => {
    const res = await request(app).post("/api/entries").send({ key: "  " });
    expect(res.status).toBe(400);
  });

  it("updates translations for an entry", async () => {
    const res = await request(app)
      .put("/api/entries/greeting.welcome")
      .send({ translations: { es: "Bienvenido de nuevo!" } });
    expect(res.status).toBe(200);
    expect(res.body.translations.es).toBe("Bienvenido de nuevo!");
  });

  it("rejects updates to unknown locales", async () => {
    const res = await request(app)
      .put("/api/entries/greeting.welcome")
      .send({ translations: { zz: "nope" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when updating a missing key", async () => {
    const res = await request(app).put("/api/entries/does.not.exist").send({ description: "x" });
    expect(res.status).toBe(404);
  });

  it("deletes an entry", async () => {
    const del = await request(app).delete("/api/entries/action.cancel");
    expect(del.status).toBe(204);
    const list = await request(app).get("/api/entries");
    expect(list.body.some((e: { key: string }) => e.key === "action.cancel")).toBe(false);
  });

  it("exports a locale as a flat key/value map", async () => {
    const res = await request(app).get("/api/export/en");
    expect(res.status).toBe(200);
    expect(res.body["app.title"]).toBe("Localiser");
    expect(res.headers["content-disposition"]).toContain("en.json");
  });

  it("returns 404 exporting an unknown locale", async () => {
    const res = await request(app).get("/api/export/zz");
    expect(res.status).toBe(404);
  });
});
