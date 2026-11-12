/** Domain error whose message is safe to show to the user. Anything else is treated as a bug. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid"
      | "not_found"
      | "forbidden"
      | "conflict"
      | "expired"
      | "rate_limited" = "invalid",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function assert(condition: unknown, message: string, code: AppError["code"] = "invalid"): asserts condition {
  if (!condition) throw new AppError(message, code);
}
