# Localiser

A lightweight localization / i18n string management tool. Manage translation keys
across multiple locales, track completion progress, and export per-locale JSON files.

## Tech stack

- **Server** — Express + TypeScript REST API (`server/`), JSON-file persistence.
- **Client** — React + TypeScript + Vite single-page app (`client/`).
- npm **workspaces** tie the two packages together.

## Getting started

```bash
npm install        # install all workspace dependencies
npm run dev        # start the API (:3001) and the web app (:5173)
```

Then open http://localhost:5173.

The Vite dev server proxies `/api/*` to the Express API on port `3001`.

## Useful commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API and web app together (watch mode). |
| `npm run dev:server` | Run just the API on port `3001`. |
| `npm run dev:client` | Run just the web app on port `5173`. |
| `npm run build` | Type-check and build both packages. |
| `npm test` | Run the server API test suite (Vitest + Supertest). |
| `npm run lint` | Lint both packages with ESLint. |
| `npm run typecheck` | Type-check both packages. |

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check. |
| `GET` | `/api/locales` | List configured locales. |
| `GET` | `/api/entries` | List all translation entries. |
| `POST` | `/api/entries` | Create a translation key. |
| `PUT` | `/api/entries/:key` | Update a key's translations/description. |
| `DELETE` | `/api/entries/:key` | Delete a key. |
| `GET` | `/api/progress` | Per-locale completion progress. |
| `GET` | `/api/export/:locale` | Download a locale as a flat JSON map. |

## Cloud Agent environment

`.cursor/environment.json` installs dependencies with `npm install` and runs the API
and web app as two persistent terminals. Ports `3001` and `5173` are exposed.
