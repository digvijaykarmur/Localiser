import { customAlphabet } from "nanoid";

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export const newId = (prefix: string) => `${prefix}_${nano()}`;

export const ids = {
  recipe: () => newId("rcp"),
  job: () => newId("job"),
  promo: () => newId("pr"),
  artifact: () => newId("art"),
  asset: () => newId("ast"),
  preset: () => newId("pst"),
  campaign: () => newId("cmp"),
  slot: () => newId("slt"),
  angle: (titleId: string, i: number) => `ang_${titleId}_${i}`,
  call: () => newId("call"),
  dialectVersion: () => newId("dlv"),
};
