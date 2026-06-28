## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best.

1. **Correctness** (1–10) — Logic correctness, no bugs
2. **Security & Safety** (1–10) — Input validation, no vulnerabilities or secret leaks
3. **Readability** (1–10) — Clarity, naming, project style consistency
4. **Performance** (1–10) — Efficiency, no obvious inefficiencies
5. **Test Coverage** (1–10) — Test coverage and testability

**Verdict**: `fail` if any score < 5 OR a significant security issue is present.

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added
