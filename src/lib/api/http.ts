export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
  }

  toResponse(): Response {
    return Response.json(this.body, { status: this.status });
  }
}
