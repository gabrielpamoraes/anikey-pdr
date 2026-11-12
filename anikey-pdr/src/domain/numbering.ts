/** "INV", 2026, 1 -> "INV-2026-0001" */
export function formatNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

/** Replace {{name}} placeholders in editable terms text. Unknown placeholders are left untouched. */
export function renderTerms(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}
