/** Typed, lazily-validated access to environment variables. */

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters");
  }
  return secret;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function bcryptCost(): number {
  const n = Number(process.env.BCRYPT_COST ?? 12);
  return Number.isInteger(n) && n >= 4 && n <= 15 ? n : 12;
}
