"use server";

import { checkConnections } from "@/providers";
import type { ChipState } from "@/providers/ports-types";

export async function checkConnectionsAction(): Promise<ChipState[]> {
  return checkConnections();
}
