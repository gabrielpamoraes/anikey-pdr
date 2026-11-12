/** Money is always integer cents. USD only. */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "-";
  return usd.format(cents / 100);
}

/**
 * Parse user input such as "1200", "1,200.50" or "$1,200" into cents.
 * Returns null when the value is not a valid positive-or-zero amount with at most 2 decimals.
 */
export function parseUsdToCents(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) return null;
  return cents;
}

/** Cents to an editable plain string, e.g. 120000 -> "1200.00". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}
