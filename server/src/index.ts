import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";
import { Store } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataFile = resolve(__dirname, "..", "data", "localiser.json");

const store = new Store(dataFile);
const app = createApp(store);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Localiser API listening on http://localhost:${port}`);
});
