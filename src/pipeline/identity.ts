/**
 * Name normalisation and slug helpers shared by the crosswalk seed and resolve.
 *
 * The teaching-area name is free text authored in several places with the pipe
 * separator written as `l`, `I`, `1`, `|`, or `/`. Normalisation folds those
 * together so a lookup against Area To Ward Key hits regardless of glyph.
 *
 * Ported from ki-pipeline/pipeline/identity.py. `encode("ascii","ignore")` in
 * the Python becomes "drop every non-ASCII code unit" after NFKD.
 */

// " l ", " | ", " / " sitting between two parts (next char is uppercase or "(")
const SEP = /\s*[|/lI1]\s*(?=[A-Z(])/g;
const WS = /\s+/g;
const SLUG_STRIP = /[^a-z0-9]+/g;

function stripToAscii(s: string): string {
  return s.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
}

/** Lowercase, strip accents, collapse whitespace, unify the part separator. */
export function normName(s: string | null | undefined): string {
  let out = String(s ?? "").trim();
  out = stripToAscii(out);
  out = out.replace(SEP, " | ");
  out = out.replace(WS, " ").trim().toLowerCase();
  return out;
}

/** A stable key fragment: "Alexandria 2  l  Assistants" -> "alexandria-2-assistants". */
export function slug(s: string | null | undefined): string {
  let out = stripToAscii(String(s ?? ""));
  out = out.replace(SEP, " ");
  out = out.toLowerCase().replace(SLUG_STRIP, "-").replace(/^-+|-+$/g, "");
  return out;
}
