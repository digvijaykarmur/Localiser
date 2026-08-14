import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { NotFoundError, Store, ValidationError } from "./store.js";

export function createApp(store: Store) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/locales", (_req, res) => {
    res.json(store.getLocales());
  });

  app.get("/api/progress", (_req, res) => {
    res.json(store.getProgress());
  });

  app.get("/api/entries", (_req, res) => {
    res.json(store.getEntries());
  });

  app.post("/api/entries", (req: Request, res: Response) => {
    const { key, description } = req.body ?? {};
    const entry = store.addEntry(key, description ?? "");
    res.status(201).json(entry);
  });

  app.put("/api/entries/:key", (req: Request, res: Response) => {
    const { description, translations } = req.body ?? {};
    const entry = store.updateEntry(req.params.key, { description, translations });
    res.json(entry);
  });

  app.delete("/api/entries/:key", (req: Request, res: Response) => {
    store.deleteEntry(req.params.key);
    res.status(204).end();
  });

  app.get("/api/export/:locale", (req: Request, res: Response) => {
    const data = store.exportLocale(req.params.locale);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.locale}.json"`,
    );
    res.json(data);
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
