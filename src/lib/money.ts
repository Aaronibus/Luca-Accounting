// Money utilities. All amounts are integer cents. All rates are basis points.

/** Format cents as €1,234.56 (negative: -€1,234.56) */
export function fmtEUR(cents: number, opts?: { sign?: boolean; compact?: boolean }): string {
  const abs = Math.abs(cents);
  const euros = abs / 100;
  let formatted: string;
  if (opts?.compact && abs >= 100_000_00) {
    formatted = `€${(euros / 1000).toLocaleString("en-IE", { maximumFractionDigits: 1 })}k`;
  } else {
    formatted = euros.toLocaleString("en-IE", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (cents < 0) return `-${formatted}`;
  if (opts?.sign && cents > 0) return `+${formatted}`;
  return formatted;
}

/** Parse a user-entered euro string ("1,234.56", "€45", "45.5") into cents. Throws on garbage. */
export function parseEUR(input: string): number {
  const cleaned = input.replace(/[€,\s]/g, "");
  if (!/^-?\d*\.?\d{0,2}$/.test(cleaned) || cleaned === "" || cleaned === "-" || cleaned === ".") {
    throw new Error(`Not a valid amount: "${input}"`);
  }
  // Avoid float drift: split on the decimal point
  const neg = cleaned.startsWith("-");
  const [whole = "0", frac = ""] = cleaned.replace("-", "").split(".");
  const cents = parseInt(whole || "0", 10) * 100 + parseInt((frac + "00").slice(0, 2) || "0", 10);
  return neg ? -cents : cents;
}

/** VAT on a net amount, in cents. Rate in basis points. Round half away from zero (Revenue practice: round to nearest cent). */
export function vatOnNet(netCents: number, rateBps: number): number {
  const raw = (netCents * rateBps) / 10000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Extract the VAT portion from a VAT-inclusive gross amount. gross = net * (1 + r) */
export function vatFromGross(grossCents: number, rateBps: number): { netCents: number; vatCents: number } {
  if (rateBps === 0) return { netCents: grossCents, vatCents: 0 };
  const rawNet = (grossCents * 10000) / (10000 + rateBps);
  const netCents = Math.sign(rawNet) * Math.round(Math.abs(rawNet));
  return { netCents, vatCents: grossCents - netCents };
}

export function bpsToPercent(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(pct * 10 === Math.round(pct * 10) ? 1 : 2)}%`;
}

/** Sum an array of cents safely. */
export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
