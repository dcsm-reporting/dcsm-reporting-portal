import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamped,
  calendarWeekOf,
  dayOfWeekMonday0,
  isIsoDate,
  lastCompleteWeekOf,
  missingMondays,
  mondayOf,
  recentMonthKeys,
  todayIso,
} from "../src/shared/dates.js";

describe("dates", () => {
  it("isIsoDate accepts real dates only", () => {
    expect(isIsoDate("2026-08-24")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("8/24/2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it("todayIso follows the mission time zone, not UTC", () => {
    // 2026-09-06 23:30 Eastern (EDT, UTC-4) is 2026-09-07 03:30 UTC
    const late = new Date("2026-09-07T03:30:00Z");
    expect(late.toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(todayIso("America/New_York", late)).toBe("2026-09-06");
    // and in winter (EST, UTC-5)
    const winter = new Date("2026-12-14T04:59:00Z");
    expect(todayIso("America/New_York", winter)).toBe("2026-12-13");
  });

  it("week helpers", () => {
    expect(dayOfWeekMonday0("2026-08-24")).toBe(0); // Monday
    expect(dayOfWeekMonday0("2026-08-30")).toBe(6); // Sunday
    expect(mondayOf("2026-08-26")).toBe("2026-08-24");
    expect(mondayOf("2026-08-30")).toBe("2026-08-24");
    expect(calendarWeekOf("2026-09-02")).toEqual({ start: "2026-08-31", end: "2026-09-06" });
    expect(addDays("2026-08-31", 6)).toBe("2026-09-06");
  });

  it("lastCompleteWeekOf: Sunday's week is not complete until Monday", () => {
    expect(lastCompleteWeekOf("2026-09-02")).toEqual({ monday: "2026-08-24", sunday: "2026-08-30" });
    expect(lastCompleteWeekOf("2026-09-06")).toEqual({ monday: "2026-08-24", sunday: "2026-08-30" }); // Sunday
    expect(lastCompleteWeekOf("2026-09-07")).toEqual({ monday: "2026-08-31", sunday: "2026-09-06" }); // Monday
  });

  it("month helpers clamp and count correctly", () => {
    expect(addMonthsClamped("2026-08-31", -6)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-08-31", -6)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-03-15", -6)).toBe("2025-09-15");
    expect(recentMonthKeys(3, "2026-01-15")).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("missingMondays finds gaps between stored weeks", () => {
    expect(missingMondays(["2026-06-01", "2026-06-15", "2026-06-22"])).toEqual(["2026-06-08"]);
    expect(missingMondays(["2026-06-01", "2026-06-08"])).toEqual([]);
    expect(missingMondays(["2026-06-01"])).toEqual([]);
    expect(missingMondays([])).toEqual([]);
    expect(missingMondays(["2026-06-01", "2026-06-29"])).toEqual(["2026-06-08", "2026-06-15", "2026-06-22"]);
  });
});
