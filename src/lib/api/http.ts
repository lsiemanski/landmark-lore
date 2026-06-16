import type { APIRoute } from "astro";

export function apiRoute(handler: APIRoute): APIRoute {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      if (err instanceof HttpError) return err.toResponse();
      throw err;
    }
  };
}

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
