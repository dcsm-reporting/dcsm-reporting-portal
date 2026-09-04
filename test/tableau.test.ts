import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSunday, normalizeAreaRows, normalizeBaptismRows, parseTable, stripIcons, toIsoDate } from "../src/shared/tableau.js";

/** The browser's readText(): UTF-16LE with a byte-order mark, as Tableau writes crosstabs. */
function readFixture(name: string): string {
  const buf = readFileSync(`test/fixtures/${name}`);
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  return buf.toString("utf8");
}

describe("dates as Tableau writes them", () => {
  it("reads ISO, day-first, month names and Excel serials", () => {
    expect(toIsoDate("2026-08-30")).toBe("2026-08-30");
    expect(toIsoDate("30/08/2026")).toBe("2026-08-30");
    expect(toIsoDate("01/09/2026")).toBe("2026-09-01"); // day first by default
    expect(toIsoDate("01/09/2026", false)).toBe("2026-01-09");
    expect(toIsoDate("24 August 2025")).toBe("2025-08-24");
    expect(toIsoDate("August 24, 2025")).toBe("2025-08-24");
    expect(toIsoDate("45123")).toBe("2023-07-16");
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate("Null")).toBeNull();
  });
  it("falls back to the other order when the first is impossible", () => {
    expect(toIsoDate("08/30/2026")).toBe("2026-08-30");
  });
  it("knows a Sunday", () => {
    expect(isSunday("2026-08-30")).toBe(true);
    expect(isSunday("2026-08-31")).toBe(false);
  });
});

describe("Missionaries Key Indicators crosstab", () => {
  const rows = normalizeAreaRows(parseTable(readFixture("tableau-ki-crosstab.csv")));
  it("yields one prepared row per area per week with Sunday week ends", () => {
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.week_end))).toEqual(new Set(["2023-01-01", "2023-01-08"]));
    expect(rows.every((r) => isSunday(r.week_end!))).toBe(true);
  });
  it("takes the area id from the 'id, date' column and keeps names as they are", () => {
    const r = rows.find((x) => x.area === "Alexandria 2  l  Assistants" && x.week_end === "2023-01-08")!;
    expect(r.area_id).toBe("141075428");
    expect(r.zone).toBe("Alexandria");
    expect(r.district).toBe("Alexandria 4");
  });
  it("maps the twelve indicator columns by header and keeps blanks blank", () => {
    const r = rows.find((x) => x.area === "Alexandria 1A" && x.week_end === "2023-01-01")!;
    expect(r.np_goal).toBe("3");
    expect(r.np_actual).toBe("2");
    expect(r.lmp_goal).toBe("");
    expect(r.sa_goal).toBe("2");
    expect(r.bc_goal).toBe("0");
    expect(r.nms_actual).toBe("1");
    expect("missionaries" in r).toBe(false);
  });
  it("also accepts the prepared CSV", () => {
    const prepared = "week_end,area_id,zone,district,area,np_goal,np_actual\n2026-05-31,7461825,Loudoun,Loudoun 3,Ashburn,4,3\n";
    const out = normalizeAreaRows(parseTable(prepared));
    expect(out).toEqual([{ week_end: "2026-05-31", area_id: "7461825", zone: "Loudoun", district: "Loudoun 3", area: "Ashburn", np_goal: "4", np_actual: "3" }]);
  });
  it("refuses a file that is neither", () => {
    expect(() => normalizeAreaRows(parseTable("a,b,c\n1,2,3\n"))).toThrow(/not an indicator file/);
  });
});

describe("People Baptized and Confirmed crosstab", () => {
  const rows = normalizeBaptismRows(parseTable(readFixture("tableau-baptisms-crosstab.csv")));
  it("reads the headerless download: id, name, zone, district, area, date", () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ external_id: "21486319", name: "", zone: "Potomac", district: "Potomac 1", area: "Bella Vista C (Sp)", baptism_date: "2023-07-16" });
    expect(rows[2]!.baptism_date).toBe("2026-09-01");
    expect(rows[3]!.baptism_date).toBe("");
  });
  it("strips the icons Tableau appends to names", () => {
    expect(rows[1]!.name).toBe("Ana Prueba");
    expect(stripIcons("Ransford McDonald📱👥")).toBe("Ransford McDonald");
    expect(stripIcons("Estella Lynch 🌊📘👥")).toBe("Estella Lynch");
  });
  it("refuses a file that is not a baptism list", () => {
    expect(() => normalizeBaptismRows(parseTable("a,b\nc,d\n"))).toThrow(/not a baptism file/);
  });
});

describe("parseTable", () => {
  it("detects tabs, honours quotes, ignores blank lines", () => {
    expect(parseTable('a\tb\n"x, y"\t"say ""hi"""\n\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    expect(parseTable("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
