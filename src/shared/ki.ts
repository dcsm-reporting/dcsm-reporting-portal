/**
 * Key Indicator vocabulary — shared by the pipeline, the API, and the web UI.
 *
 * IMOS identifies each indicator by a numeric id. Reference by id, NEVER by
 * column position. `KI_IDS` is in the mission's display order
 * (BC, BD, SA, NP, LMP, NMS); every grid's column order derives from it.
 *
 * Ported from ki-pipeline/pipeline/constants.py — keep the two in step.
 */

export const KI_IDS = [20, 30, 40, 100, 600, 300] as const;
export type KiId = (typeof KI_IDS)[number];

export const KI_CODE: Record<KiId, string> = {
  20: "BC",
  30: "BD",
  40: "SA",
  100: "NP",
  600: "LMP",
  300: "NMS",
};

export const KI_NAME: Record<KiId, string> = {
  20: "People Who Are Baptized and Confirmed",
  30: "People With a Baptismal Date",
  40: "People Who Attend Sacrament Meeting",
  100: "New People Being Taught",
  600: "Lessons With a Member Participating",
  300: "New Members Attending Sacrament Meeting",
};

/** The label the old Google Slides decks used, for anyone cross-referencing. */
export const KI_DECK_LABEL: Record<KiId, string> = {
  20: "BC",
  30: "BD",
  40: "SAC",
  100: "NP",
  600: "LWM",
  300: "RCA",
};

export const KI_ID_SET: ReadonlySet<number> = new Set(KI_IDS);

export function kiCode(id: KiId): string {
  return KI_CODE[id];
}
