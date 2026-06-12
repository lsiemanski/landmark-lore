import type { APIContext } from "astro";

export function makeAPIContext(body: BodyInit, options?: { url?: string; method?: string }): APIContext {
  return {
    request: new Request(options?.url ?? "http://localhost/api/identify", {
      method: options?.method ?? "POST",
      body,
    }),
    cookies: {},
  } as unknown as APIContext;
}
