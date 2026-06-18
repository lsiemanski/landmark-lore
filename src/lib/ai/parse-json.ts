/**
 * Parse JSON returned by a model, tolerating the common ways models wrap it even
 * when a JSON response format was requested: markdown code fences (```json … ```)
 * and a line of prose before or after the object. Throws "Malformed AI response"
 * — with a truncated snippet of the offending content for logging — when no valid
 * JSON object can be recovered.
 */
export function parseModelJson(content: string): unknown {
  const cleaned = stripCodeFence(content.trim());

  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractJsonObject(cleaned);
    if (extracted !== null) {
      try {
        return JSON.parse(extracted);
      } catch {
        // fall through to the shared failure path
      }
    }
    throw new Error(`Malformed AI response: ${cleaned.slice(0, 200)}`);
  }
}

/** Unwrap a ```json … ``` (or bare ``` … ```) fenced block. */
function stripCodeFence(s: string): string {
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(s);
  return match ? match[1].trim() : s;
}

/** Slice out the first complete `{ … }` span, ignoring surrounding prose. */
function extractJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}
