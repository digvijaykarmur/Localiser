import { env } from "@/config/env";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, scope: string, msg: string, data?: Record<string, unknown>) {
  if (order[level] < order[env.LOG_LEVEL]) return;
  const line = { t: new Date().toISOString(), level, scope, msg, ...(data ?? {}) };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export const log = (scope: string) => ({
  debug: (msg: string, data?: Record<string, unknown>) => emit("debug", scope, msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit("info", scope, msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit("warn", scope, msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit("error", scope, msg, data),
});
