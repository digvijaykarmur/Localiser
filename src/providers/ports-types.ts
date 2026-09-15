/** Types safe to import from client components (no Node dependencies). */
export type ChipState = { name: string; state: "ok" | "snapshot" | "error"; detail: string };
