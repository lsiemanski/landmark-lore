import { readFileSync, writeFileSync } from "node:fs";
import { reviewCode } from "@landmark-lore/code-reviewer";

const MAX_DIFF_BYTES = 200_000;

function buildReviewInput(title: string, body: string, diff: string): string {
  const truncationNotice = `\n\n[diff truncated — exceeded ${MAX_DIFF_BYTES} bytes]`;
  const safeDiff = diff.length > MAX_DIFF_BYTES ? diff.slice(0, MAX_DIFF_BYTES) + truncationNotice : diff;
  const bodyBlock = body.length > 0 ? `\n\n${body}` : "";
  return `PR: ${title}${bodyBlock}\n\n---\n\n${safeDiff}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  process.stderr.write(`Error: required env var ${name} is not set\n`);
  process.exit(1);
}

try {
  const prTitle = process.env.PR_TITLE ?? "";
  const prBody = process.env.PR_BODY ?? "";
  const diffFile = requireEnv("PR_DIFF_FILE");
  const outputFile = requireEnv("REVIEW_OUTPUT_FILE");

  const diff = readFileSync(diffFile, "utf-8");
  const input = buildReviewInput(prTitle, prBody, diff);
  const result = await reviewCode(input);
  writeFileSync(outputFile, JSON.stringify(result));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
