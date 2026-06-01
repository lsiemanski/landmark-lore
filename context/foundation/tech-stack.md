---
starter_id: 10x-astro-starter
package_manager: npm
project_name: landmark-lore
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

Landmark Lore is a solo-built web app shipping on an after-hours, 3-week timeline with auth, file storage, and an AI identification layer as must-have FRs. The recommended default for `(web-app, js)` is 10x-astro-starter — Astro 6 + React 19 + Supabase + Cloudflare — which covers auth (Supabase Auth), file storage (Supabase Storage), and PostgreSQL out of the box, meaning the three hardest-to-retrofit FRs are solved at scaffold time. TypeScript across the full stack keeps the AI integration layer explicit and type-safe with Zod schemas at every boundary. The starter clears all four agent-friendly quality gates; bootstrapper confidence is first-class. AI identification (FR-004/FR-005) will be integrated via an external AI service API call from Astro server endpoints — no starter-level change required. Deployment lands on Cloudflare Pages with GitHub Actions auto-deploying on merge to main, matching the starter's default operational shape and keeping infra setup minimal for a solo developer working after hours.
