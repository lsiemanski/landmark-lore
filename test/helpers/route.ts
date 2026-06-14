import type { APIContext } from "astro";

export function makeAPIContext(body: BodyInit, options?: { url?: string; method?: string }): APIContext {
  const requestUrl = options?.url ?? "http://localhost/api/identify";
  return {
    request: new Request(requestUrl, {
      method: options?.method ?? "POST",
      body,
    }),
    url: new URL(requestUrl),
    cookies: {},
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}
