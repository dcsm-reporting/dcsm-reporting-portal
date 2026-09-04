import { describe, expect, it } from "vitest";
import { baptismProgress, isGoalValue, isPeriod, missionGoal, monthlyMissionGoals, type GoalRow } from "../src/pipeline/goals.js";

const friend = (name: string, date: string | null, zone: string, extra: Partial<{ baptizedConfirmed: boolean; confidence: string | null; source: string }> = {}) => ({
  name,
  baptismDate: date,
  zone,
  baptizedConfirmed: extra.baptizedConfirmed ?? true,
  confidence: extra.confidence ?? null,
  source: extra.source ?? "sheet",
});

describe("periods and values", () => {
  it("accepts YYYY and YYYY-MM only", () => {
    expect(isPeriod("2026")).toBe(true);
    expect(isPeriod("2026-09")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("2026-9")).toBe(false);
    expect(isPeriod("26-09")).toBe(false);
    expect(isPeriod(2026)).toBe(false);
  });
  it("goals are whole numbers 0..9999", () => {
    expect(isGoalValue(0)).toBe(true);
    expect(isGoalValue(20)).toBe(true);
    expect(isGoalValue(-1)).toBe(false);
    expect(isGoalValue(2.5)).toBe(false);
    expect(isGoalValue("20")).toBe(false);
  });
});

describe("mission goal", () => {
  const rows: GoalRow[] = [
    { period: "2026-09", zone: "Alexandria", goal: 8 },
    { period: "2026-09", zone: "Annandale", goal: 6 },
    { period: "2026-10", zone: "", goal: 25 },
    { period: "2026-10", zone: "Alexandria", goal: 9 },
  ];
  it("is the sum of zone goals when not set directly", () => {
    expect(missionGoal(rows, "2026-09")).toEqual({ goal: 14, derived: true });
  });
  it("is the explicit value when set, even with zone goals present", () => {
    expect(missionGoal(rows, "2026-10")).toEqual({ goal: 25, derived: false });
  });
  it("is null with no rows for the period", () => {
    expect(missionGoal(rows, "2026-11")).toEqual({ goal: null, derived: false });
    expect(monthlyMissionGoals(rows, ["2026-09", "2026-11"])).toEqual({ "2026-09": 14, "2026-11": null });
  });
});

describe("progress", () => {
  const rows: GoalRow[] = [
    { period: "2026-09", zone: "Alexandria", goal: 8 },
    { period: "2026-09", zone: "Annandale", goal: 6 },
    { period: "2026", zone: "", goal: 150 },
  ];
  const friends = [
    friend("Ana Lima", "2026-09-05", "Alexandria"),
    friend("Ana Lima", "2026-09-05", "Alexandria", { source: "legacy" }), // duplicate, collapsed
    friend("Ben Cho", "2026-09-12", "Alexandria"),
    friend("Cara Diaz", "2026-09-20", "Annandale"),
    friend("Dan Ito", "2026-09-27", "Langley"), // zone with no goal
    friend("Eve Ng", "2026-03-01", "Alexandria"),
    friend("Old Record", "2026-09-01", "Alexandria", { confidence: "unverified" }), // not counted
    friend("Still On Date", "2026-09-30", "Alexandria", { baptizedConfirmed: false }),
  ];
  const p = baptismProgress(friends, rows, "2026-09-15");

  it("counts confirmed, de-duplicated baptisms for the month and year", () => {
    expect(p.month).toBe("2026-09");
    expect(p.mission.month).toEqual({ goal: 14, actual: 4, derived: true });
    expect(p.mission.year).toEqual({ goal: 150, actual: 5, derived: false });
  });
  it("lists only zones with a goal, with their own actuals", () => {
    expect(Object.keys(p.zones)).toEqual(["Alexandria", "Annandale"]);
    expect(p.zones.Alexandria!.month).toEqual({ goal: 8, actual: 2, derived: false });
    expect(p.zones.Annandale!.month).toEqual({ goal: 6, actual: 1, derived: false });
    expect(p.zones.Alexandria!.year.goal).toBeNull();
  });
  it("reports no goals at all when there are no rows", () => {
    const none = baptismProgress(friends, [], "2026-09-15");
    expect(none.any).toBe(false);
    expect(none.mission.month.goal).toBeNull();
    expect(none.mission.month.actual).toBe(4);
    expect(none.zones).toEqual({});
  });
});
