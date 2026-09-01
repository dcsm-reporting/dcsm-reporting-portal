import { describe, expect, it } from "vitest";
import { normName, slug } from "../src/pipeline/identity.js";

describe("normName", () => {
  it("lowercases, trims, collapses whitespace", () => {
    expect(normName("  Fairfax   Ward ")).toBe("fairfax ward");
  });

  it("unifies the divided-area separator across glyphs", () => {
    const canonical = "alexandria 2 | assistants";
    expect(normName("Alexandria 2 l Assistants")).toBe(canonical);
    expect(normName("Alexandria 2 | Assistants")).toBe(canonical);
    expect(normName("Alexandria 2 I Assistants")).toBe(canonical);
    expect(normName("Alexandria 2 / Assistants")).toBe(canonical);
    expect(normName("Alexandria 2  l  Assistants")).toBe(canonical);
  });

  it("strips accents", () => {
    expect(normName("Peña Blanca")).toBe("pena blanca");
  });

  it("handles null / undefined", () => {
    expect(normName(null)).toBe("");
    expect(normName(undefined)).toBe("");
  });
});

describe("slug", () => {
  it("produces a stable key fragment", () => {
    expect(slug("Alexandria 2  l  Assistants")).toBe("alexandria-2-assistants");
    expect(slug("Fort Belvoir")).toBe("fort-belvoir");
    expect(slug("Opal l Auburn")).toBe("opal-auburn");
    expect(slug("Rolling Valley | Office")).toBe("rolling-valley-office");
  });

  it("trims leading/trailing separators", () => {
    expect(slug("  --Fairfax--  ")).toBe("fairfax");
  });
});
