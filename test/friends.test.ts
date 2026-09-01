import { describe, expect, it } from "vitest";
import {
  cleanTime,
  isOnDate,
  missionaryLastNames,
  summarise,
  toIsoDate,
  yn,
  type Friend,
} from "../src/pipeline/friends.js";

describe("cleanTime", () => {
  it("pulls the clock time out of a Sheets datetime string", () => {
    expect(cleanTime("Sat Dec 30 1899 10:00:00 GMT-0500 (Eastern Standard Time)")).toBe("10:00 AM");
    expect(cleanTime("Sat Dec 30 1899 17:00:00 GMT-0500 (Eastern Standard Time)")).toBe("5:00 PM");
  });
  it("passes through plain values", () => {
    expect(cleanTime("TBD")).toBe("TBD");
    expect(cleanTime("2:00PM")).toBe("2:00 PM");
    expect(cleanTime("")).toBeNull();
    expect(cleanTime(null)).toBeNull();
  });
});

describe("yn", () => {
  it("reads the workbook's Y/N", () => {
    expect(yn("Y")).toBe(true);
    expect(yn("yes")).toBe(true);
    expect(yn(true)).toBe(true);
    expect(yn("N")).toBe(false);
    expect(yn("")).toBe(false);
    expect(yn(null)).toBe(false);
  });
});

describe("toIsoDate", () => {
  it("normalises m/d/yy and ISO", () => {
    expect(toIsoDate("8/15/26")).toBe("2026-08-15");
    expect(toIsoDate("2026-09-13")).toBe("2026-09-13");
    expect(toIsoDate(new Date("2026-08-23T00:00:00Z"))).toBe("2026-08-23");
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate("TBD")).toBeNull();
  });
});

describe("missionaryLastNames", () => {
  it("splits the workbook's format", () => {
    expect(missionaryLastNames("Elders Zhou & Lake")).toEqual(["Zhou", "Lake"]);
    expect(missionaryLastNames("Sisters Hansen & Elton & Wolfley")).toEqual([
      "Hansen",
      "Elton",
      "Wolfley",
    ]);
    expect(missionaryLastNames("")).toEqual([]);
  });
});

const F = (p: Partial<Friend>): Friend => ({
  id: "x",
  name: "Test",
  zone: null,
  canonicalAreaKey: null,
  ward: null,
  stake: null,
  missionaries: null,
  baptismDate: null,
  baptismTime: null,
  baptismAddress: null,
  attendedChurch2x: false,
  onBaptismCalendar: false,
  baptizedConfirmed: false,
  dropped: false,
  source: "portal",
  createdAt: "2026-08-01",
  createdBy: null,
  updatedAt: "2026-08-01",
  updatedBy: null,
  ...p,
});

describe("isOnDate / summarise", () => {
  it("on date = has a date, not confirmed, not dropped", () => {
    expect(isOnDate(F({ baptismDate: "2026-09-13" }))).toBe(true);
    expect(isOnDate(F({ baptismDate: "2026-09-13", baptizedConfirmed: true }))).toBe(false);
    expect(isOnDate(F({ baptismDate: "2026-09-13", dropped: true }))).toBe(false);
    expect(isOnDate(F({ baptismDate: null }))).toBe(false);
  });

  it("summary buckets against a week", () => {
    const friends = [
      F({ baptismDate: "2026-09-03", onBaptismCalendar: true, attendedChurch2x: true }), // on date, this week
      F({ baptismDate: "2026-09-20" }), // on date, later
      F({ baptismDate: "2026-09-01", baptizedConfirmed: true }), // baptised this month
      F({ baptismDate: "2026-08-15", baptizedConfirmed: true }), // baptised prior month
      F({ baptismDate: "2026-10-01", dropped: true }), // dropped — ignored
    ];
    const s = summarise(friends, "2026-09-01"); // week 9/1–9/7
    expect(s.onDateTotal).toBe(2);
    expect(s.onDateThisWeek).toBe(1);
    expect(s.baptizedThisMonth).toBe(1);
    expect(s.calendarYes).toBe(1);
    expect(s.church2xYes).toBe(1);
  });
});
