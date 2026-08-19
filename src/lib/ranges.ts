export function rangeToDates(range: string | undefined): { from: Date; to: Date; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  switch (range) {
    case "lastmonth": {
      const from = new Date(Date.UTC(y, m - 1, 1));
      return { from, to: new Date(Date.UTC(y, m, 0, 23, 59, 59)), label: from.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" }) };
    }
    case "quarter": {
      const qs = Math.floor(m / 3) * 3;
      return { from: new Date(Date.UTC(y, qs, 1)), to: new Date(Date.UTC(y, qs + 3, 0, 23, 59, 59)), label: `Q${Math.floor(m / 3) + 1} ${y}` };
    }
    case "ytd":
      return { from: new Date(Date.UTC(y, 0, 1)), to: now, label: `Jan–${now.toLocaleDateString("en-IE", { month: "short", timeZone: "UTC" })} ${y}` };
    default: {
      const from = new Date(Date.UTC(y, m, 1));
      return { from, to: now, label: from.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" }) };
    }
  }
}
