import type { APIContext } from "astro";

export function makeAPIContext(
  body: BodyInit | null,
  options?: { url?: string; method?: string; params?: Record<string, string> },
): APIContext {
  const requestUrl = options?.url ?? "http://localhost/api/identify";
  const method = options?.method ?? "POST";
  const isBodyless = method === "GET" || method === "HEAD" || method === "DELETE";
  return {
    request: isBodyless ? new Request(requestUrl, { method }) : new Request(requestUrl, { method, body }),
    url: new URL(requestUrl),
    cookies: {},
    params: options?.params ?? {},
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}
