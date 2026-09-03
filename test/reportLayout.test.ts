import { describe, expect, it } from "vitest";
import { DEFAULT_STAKE_REPORT_LAYOUT, normalizeLayout } from "../src/shared/reportLayout.js";

describe("stake report layout", () => {
  it("the default is complete and valid", () => {
    const { layout, problem } = normalizeLayout(DEFAULT_STAKE_REPORT_LAYOUT);
    expect(problem).toBeNull();
    expect(layout).toEqual(DEFAULT_STAKE_REPORT_LAYOUT);
  });

  it("repairs a partial or odd stored value instead of failing", () => {
    const { layout, problem } = normalizeLayout({
      sections: [{ id: "baptized", enabled: true }, { id: "bogus", enabled: true }, { id: "baptized", enabled: false }],
      kis: [100, 999, 30],
      trendWeeks: 400,
      baptizedMonths: 0,
      introText: 42,
    });
    expect(problem).toBeNull();
    expect(layout.sections[0]).toEqual({ id: "baptized", enabled: true });
    expect(layout.sections.map((s) => s.id).sort()).toEqual(
      ["intro", "stats", "wardTable", "trend", "onDate", "baptized", "note"].sort(),
    );
    expect(layout.sections.filter((s) => s.enabled).map((s) => s.id)).toEqual(["baptized"]);
    expect(layout.kis).toEqual([100, 30]);
    expect(layout.trendWeeks).toBe(26);
    expect(layout.baptizedMonths).toBe(1);
    expect(layout.introText).toBe("");
    expect(layout.onDate.extra).toEqual([]);
  });

  it("keeps extra on-date columns (sheet headers), trimmed and capped", () => {
    const { layout } = normalizeLayout({ onDate: { extra: [" Phone ", "", 5, "Referral", "a", "b", "c", "d", "e", "f", "g"] } });
    expect(layout.onDate.extra.slice(0, 2)).toEqual(["Phone", "Referral"]);
    expect(layout.onDate.extra.length).toBe(8);
  });

  it("refuses a layout with no indicators", () => {
    expect(normalizeLayout({ kis: [] }).problem).toMatch(/indicator/);
    expect(normalizeLayout(null).problem).toMatch(/object/);
  });
});
