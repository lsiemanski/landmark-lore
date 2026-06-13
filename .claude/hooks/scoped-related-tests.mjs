#!/usr/bin/env node
/**
 * PostToolUse(Write|Edit) hook — scoped "related tests" trigger.
 *
 * Runs ONLY the tests related to the file the agent just edited, and only when
 * that file lives in the project's highest-risk area. Edits outside the area are
 * ignored, so the hook never spawns Vitest for unrelated files (no false alarms,
 * zero overhead on the common case).
 *
 * Highest risk = Risk #1 in context/foundation/test-plan.md:
 *   "A wrong / low-confidence identification is presented as a verified fact,
 *    or the not-recognised case renders blank instead of the explicit state."
 * Its anchors (and the tests that cover them today):
 *   src/lib/ai/**            -> test/unit/identification.test.ts
 *   src/pages/api/identify.ts-> test/integration/identify-route.test.ts
 *
 * Mechanism (Vitest 4.1+, verified against /vitest-dev/vitest v4.1.6 docs):
 *   `vitest related <file> --run`  runs only the test files that statically
 *                                  import <file>; --run exits instead of watching.
 *   AI_AGENT=1                     activates the compact agent reporter.
 *   <file> must be relative to the repo root.
 *
 * Exit codes: 0 = nothing to do / tests passed; 2 = related tests failed, so the
 * failure output is fed back to the agent to fix.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/** True when the edited file is inside the Risk #1 identification-contract area. */
function isInRiskArea(relPath) {
  return relPath.startsWith("src/lib/ai/") || relPath === "src/pages/api/identify.ts";
}

/** Parse the hook's stdin JSON and return the edited file as a root-relative POSIX path. */
function getEditedFileRelPath() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8")); // fd 0 = stdin
  } catch {
    return null; // no/invalid payload -> nothing to do
  }

  const absPath = payload?.tool_input?.file_path;
  if (!absPath) return null;

  // Normalise to a root-relative, forward-slash path (vitest wants paths
  // relative to root; the gate compares against forward-slash prefixes).
  return path.relative(process.cwd(), absPath).split(path.sep).join("/");
}

const relPath = getEditedFileRelPath();
if (!relPath || !isInRiskArea(relPath)) {
  process.exit(0); // outside Risk #1 -> don't even start Vitest
}

const result = spawnSync("npx", ["vitest", "related", relPath, "--run"], {
  // Route the child's stdout AND stderr to our stderr so the report is visible
  // (and, on failure, is the text fed back to the agent under exit code 2).
  stdio: ["ignore", 2, 2],
  env: { ...process.env, AI_AGENT: "1" },
  shell: true, // needed so `npx` resolves to npx.cmd on Windows
});

if (result.error) {
  // Tooling couldn't start (e.g. npx missing) — surface it but don't block.
  process.stderr.write(`[scoped-related-tests] could not run vitest: ${result.error.message}\n`);
  process.exit(0);
}

process.exit(result.status === 0 ? 0 : 2);
