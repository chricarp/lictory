export class DomainError extends Error {
  constructor(
    public category:
      "forbidden" | "unavailable" | "not_found" | "conflict" | "validation",
    message: string,
    public currentRevisionId?: string,
    // Machine-readable reason clients can act on, e.g. "two_factor_required".
    public kind?: string,
  ) {
    super(message);
  }
}
