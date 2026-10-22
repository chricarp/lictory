export class DomainError extends Error {
  constructor(
    public category: "forbidden" | "unavailable" | "conflict" | "validation",
    message: string,
    public currentRevisionId?: string,
  ) {
    super(message);
  }
}
