export class DomainError extends Error {
  constructor(
    public category:
      "forbidden" | "unavailable" | "not_found" | "conflict" | "validation",
    message: string,
    public currentRevisionId?: string,
  ) {
    super(message);
  }
}
