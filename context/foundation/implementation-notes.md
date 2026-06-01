# Implementation Notes

Cross-cutting decisions and integration steps that apply before or across all development changes. Edit in place as the project evolves.

---

## Post-scaffold: Spring AI integration (FR-004, FR-005)

The Spring Boot scaffold (`/10x-bootstrapper`) does **not** include AI/LLM support. After scaffolding, add Spring AI as a dependency.

**Why it's needed:**
- FR-004: Traveler receives an identification and description of the subject in an uploaded photo.
- FR-005: Traveler can ask follow-up questions about an identified subject.

**What to add:**
- `spring-ai-bom` (BOM for version management) to `pom.xml`
- The appropriate Spring AI starter for the chosen provider (e.g., `spring-ai-openai-spring-boot-starter` or `spring-ai-anthropic-spring-boot-starter`)
- An `application.properties` / `application.yml` key for the provider API key (externalized via environment variable — never committed)

**Provider not yet decided.** The PRD specifies "external AI service" without naming one. Decide before implementing FR-004; Claude API (Anthropic) and OpenAI Vision are the two candidates given the visual recognition requirement.

**Acceptance gate:** Identification must return a subject name plus a substantive contextual description — not just a label (per US-01 AC). "Not recognized" must surface as an explicit state, never a blank (FR-004 / guardrail).
