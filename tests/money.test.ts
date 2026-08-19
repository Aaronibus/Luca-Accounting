import { describe, it, expect } from "vitest";
import { parseEUR, vatOnNet, vatFromGross, fmtEUR } from "../src/lib/money";

describe("money", () => {
  it("parses euro strings to cents", () => {
    expect(parseEUR("1,234.56")).toBe(123456);
    expect(parseEUR("€45")).toBe(4500);
    expect(parseEUR("45.5")).toBe(4550);
    expect(parseEUR("-12.34")).toBe(-1234);
    expect(parseEUR("0.01")).toBe(1);
    expect(() => parseEUR("abc")).toThrow();
    expect(() => parseEUR("1.234")).toThrow(); // 3 decimal places
  });

  it("computes VAT on net without float drift", () => {
    expect(vatOnNet(10000, 2300)).toBe(2300); // €100 @ 23% = €23
    expect(vatOnNet(999, 2300)).toBe(230); // €9.99 @ 23% = €2.2977 → €2.30
    expect(vatOnNet(10000, 1350)).toBe(1350);
    expect(vatOnNet(10000, 900)).toBe(900);
    expect(vatOnNet(10000, 0)).toBe(0);
    expect(vatOnNet(1, 2300)).toBe(0); // 0.23c rounds to 0
    expect(vatOnNet(3, 2300)).toBe(1); // 0.69c rounds to 1
  });

  it("extracts VAT from gross correctly", () => {
    const { netCents, vatCents } = vatFromGross(12300, 2300);
    expect(netCents).toBe(10000);
    expect(vatCents).toBe(2300);
    expect(netCents + vatCents).toBe(12300);

    // gross that doesn't divide evenly must still sum exactly
    const odd = vatFromGross(9999, 2300);
    expect(odd.netCents + odd.vatCents).toBe(9999);

    const zero = vatFromGross(5000, 0);
    expect(zero.netCents).toBe(5000);
    expect(zero.vatCents).toBe(0);
  });

  it("formats EUR", () => {
    expect(fmtEUR(123456)).toContain("1,234.56");
    expect(fmtEUR(-500)).toMatch(/^-/);
  });
});
