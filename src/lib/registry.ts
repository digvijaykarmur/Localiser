import { DialectPack, FormatDef, type DialectCode, type FormatCode } from "@/domain";
import hry from "@/data/dialects/hry.json";
import raj from "@/data/dialects/raj.json";
import bho from "@/data/dialects/bho.json";
import guj from "@/data/dialects/guj.json";
import mar from "@/data/dialects/mar.json";
import ben from "@/data/dialects/ben.json";
import sc from "@/data/formats/SC.json";
import cp from "@/data/formats/CP.json";
import su from "@/data/formats/SU.json";

const PACKS: Record<DialectCode, DialectPack> = {
  hry: DialectPack.parse(hry),
  raj: DialectPack.parse(raj),
  bho: DialectPack.parse(bho),
  guj: DialectPack.parse(guj),
  mar: DialectPack.parse(mar),
  ben: DialectPack.parse(ben),
};

const FORMATS: Record<FormatCode, FormatDef> = {
  SC: FormatDef.parse(sc),
  CP: FormatDef.parse(cp),
  SU: FormatDef.parse(su),
};

export function getDialectPack(code: DialectCode): DialectPack {
  const pack = PACKS[code];
  if (!pack) throw new Error(`unknown dialect ${code}`);
  return pack;
}

export function allDialectPacks(): DialectPack[] {
  return Object.values(PACKS);
}

export function getFormat(code: FormatCode): FormatDef {
  return FORMATS[code];
}
