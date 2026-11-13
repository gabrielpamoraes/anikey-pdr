/**
 * Date helpers. Document dates are ISO date strings (YYYY-MM-DD) with no time zone;
 * instants (signed at, sent at) are real Dates formatted in the organization's time zone.
 * US formats only (MM/DD/YYYY).
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** "2026-10-24" -> "10/24/2026" (no time zone math, so it never shifts a day). */
export function formatDateUS(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const m = ISO_DATE.exec(iso);
  if (!m) return "-";
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** "10/24/2026, 9:42 AM PDT" in the given IANA time zone. */
export function formatDateTimeUS(value: Date | null | undefined, timeZone: string): string {
  if (!value) return "-";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(value);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
  return `${date}, ${time}`;
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayISO(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA yields YYYY-MM-DD
}

export function addDaysISO(iso: string, days: number): string {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}

export function yearInTimeZone(timeZone: string, now: Date = new Date()): number {
  return Number(todayISO(timeZone, now).slice(0, 4));
}

/** A DATE column value (Date at UTC midnight) to ISO string. */
export function dateColumnToISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** ISO string to a value Prisma accepts for a DATE column. */
export function isoToDateColumn(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
