import { describe, expect, it } from "vitest";
import { addDaysISO, formatDateTimeUS, formatDateUS, isValidISODate, todayISO } from "@/lib/dates";
import { centsToInput, formatUsd, parseUsdToCents } from "@/lib/money";

describe("money", () => {
  it("parses common inputs into integer cents", () => {
    expect(parseUsdToCents("1200")).toBe(120000);
    expect(parseUsdToCents("$1,200.5")).toBe(120050);
    expect(parseUsdToCents(" 0.99 ")).toBe(99);
    expect(parseUsdToCents("1,234,567.89")).toBe(123456789);
  });
  it("rejects anything that is not a plain amount", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3", "12,3,4x", "$", "1.", ".5", "NaN", "1 000"]) {
      expect(parseUsdToCents(bad), bad).toBeNull();
    }
    expect(parseUsdToCents(null)).toBeNull();
    expect(parseUsdToCents("999999999999")).toBeNull();
  });
  it("formats", () => {
    expect(formatUsd(120000)).toBe("$1,200.00");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(null)).toBe("-");
    expect(centsToInput(120050)).toBe("1200.50");
    expect(centsToInput(null)).toBe("");
  });
});

describe("dates", () => {
  it("validates ISO dates strictly", () => {
    expect(isValidISODate("2026-02-28")).toBe(true);
    expect(isValidISODate("2028-02-29")).toBe(true);
    expect(isValidISODate("2026-02-29")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("10/24/2026")).toBe(false);
  });
  it("formats US dates without shifting the day", () => {
    expect(formatDateUS("2026-10-24")).toBe("10/24/2026");
    expect(formatDateUS(new Date("2026-01-01T00:00:00.000Z"))).toBe("01/01/2026");
    expect(formatDateUS(null)).toBe("-");
  });
  it("adds days across month and year ends", () => {
    expect(addDaysISO("2026-10-24", 14)).toBe("2026-11-07");
    expect(addDaysISO("2026-12-25", 10)).toBe("2027-01-04");
    expect(addDaysISO("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("uses the organization's time zone for 'today' and timestamps", () => {
    const instant = new Date("2026-11-01T03:30:00.000Z"); // still Oct 31 in Los Angeles
    expect(todayISO("America/Los_Angeles", instant)).toBe("2026-10-31");
    expect(todayISO("America/New_York", instant)).toBe("2026-10-31");
    expect(todayISO("Europe/Berlin", instant)).toBe("2026-11-01");
    expect(formatDateTimeUS(new Date("2026-10-24T16:42:00.000Z"), "America/Los_Angeles")).toBe("10/24/2026, 9:42 AM PDT");
  });
});
