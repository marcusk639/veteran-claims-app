# Phase 4: Best Practices & Standards

## Framework & Language Findings

Verified against the actually-installed Next.js 16.2.10 docs (not training data). The `middleware.ts` → `proxy.ts` rename is correctly applied. Overall the codebase is idiomatic: `tsconfig strict: true`, no `any`/`@ts-ignore` anywhere, clean Server/Client component boundaries, correct AI SDK v7 idioms (`useChat`, `DefaultChatTransport`, `stepCountIs`, `convertToModelMessages`), and Zod is already used correctly for MCP tool schemas — the gap is narrowly the HTTP request boundary, not a wholesale absence of validation discipline.

### High

- **1. No request-boundary validation on `/api/chat` despite Zod being a dependency and used correctly elsewhere** (`route.ts:78`, bare `as ChatRequestBody` cast). Same issue independently confirmed by Security (H1), Testing (Finding 5), and now Best Practices — four independent confirmations. `body.conversationId` flowing into a `uuid` column with no validation will throw an unhandled driver error on malformed input.

### Medium

- **3. `streamText` doesn't forward request cancellation** (`route.ts:135` — no `abortSignal`). AI SDK v7's `streamText` accepts `abortSignal` specifically so in-flight generation stops when the client disconnects. Given this app has a whole cost-tracking system built around per-message token cost, an abandoned request (tab closed mid-stream) currently runs to completion and bills full tokens anyway. **Fix: pass `abortSignal: req.signal`.**

### Low

- 2. Clerk webhook route asserts (doesn't validate) the verified payload shape — low priority since svix already verifies authenticity, but a small Zod schema would close a silent-failure gap cheaply.
- 4. Env var validation (`getRequiredEnv`) is deferred to first use rather than validated eagerly at boot — every call site already defensively handles this, so not broken, just not fail-fast.
- 5. Stale doc comment in `.env.example` still references `src/middleware.ts` (renamed to `proxy.ts`) — one-line fix, same root issue as Documentation Finding #7.
- 6. Minor patch-version drift on `react`/`react-dom`, `ai`, `@ai-sdk/react`, `@clerk/nextjs` — routine `pnpm update` candidates, no urgency.
- 7. `AI_GATEWAY_API_KEY` is used implicitly (works via Vercel OIDC) but undocumented in `.env.example` — needed for local dev/non-Vercel hosts.

### Confirmed correct, no action needed

- `proxy.ts` file convention, matcher, and default-export shape are all correct per Next.js 16 docs.
- `after()` usage in the webhook route matches the documented pattern exactly.
- Server/Client component boundaries are clean; `"use client"` scoped only to the chat page that needs `useChat`.

## CI/CD & DevOps Findings

**Overriding finding: there is no CI/CD pipeline, no monitoring, and no incident-response documentation for this repo at all** — every other finding below is downstream of that absence. Checked both the worktree and main repo root; the gap is repo-wide, not branch-specific. The sibling `rag-system` repo has a real CI pipeline and documented migration ownership, sharpening the asymmetry — this app hasn't caught up yet, which is normal at scaffold stage but should close before this feature branch (auth + payments-adjacent cost tracking) reaches real users.

### Critical

- **1. No CI/CD pipeline exists at all** — no `.github/workflows/`, no other CI config anywhere. Every merge ships without automated build/typecheck/lint/test gates. **Recommendation: add a minimal quality-gate workflow** (build → typecheck → lint → unit test on PR/push to main), modeled on `rag-system`'s existing `ci.yml`. Add Dependabot for `npm`/`github-actions` given this app now handles auth and cost tracking.

### High

- **2. No Vercel-specific deployment config** (`vercel.json`), no documented rollback/canary procedure — build/output/env settings live only in the Vercel dashboard, invisible to PR review.
- **4. No infra-level monitoring or observability** — no health-check endpoint, no error-tracking SDK (Sentry/equivalent — zero hits in the codebase), no alerting on the `rag-system` MCP dependency's health. This is a bigger gap than the cost-alert webhook fragility already flagged in Phase 2, since right now no unhandled exception in any route is visible anywhere except raw Vercel function logs.
- **5. No incident response documentation** — no runbooks, no on-call docs, no rollback playbook anywhere. Combined with #4, an incident today would be diagnosed entirely from raw logs with no pre-written procedure.

### Medium

- **3. DB migrations are version-controlled but not wired into the deploy path** — `drizzle/` has 4 sequential safe-to-rerun migrations and a `db:migrate` script, but nothing runs it automatically on deploy. A schema-changing PR can merge and deploy while the migration is still unapplied.
- **6. Environment management is mostly solid** (`.env.local` correctly gitignored, `.env.example` well-commented) but `package.json` has no `packageManager`/`engines` field pinning the pnpm/Node version, unlike `rag-system`'s CI — risks silent drift across dev/CI/Vercel build images. Also no confirmation that Neon branch-per-environment is used for staging/prod isolation.

## Critical Issues for Phase 5 Synthesis

- The request-body-validation gap (Best Practices #1) is now confirmed independently by **four** separate reviewers across three phases (Security H1, Testing Finding 5, Best Practices #1, and implicitly Documentation #4/#5) — this should be treated as the single highest-confidence, highest-priority fix in the final report alongside the conversation-persistence and `after()`-wrapping issues.
- The complete absence of CI/CD is a standalone, high-leverage fix (a basic GitHub Actions workflow) that would have caught several of the bugs found in this review (e.g., a lint/typecheck gate doesn't catch the conversation-persistence logic bug, but a required `pnpm test` gate combined with the testing fixes recommended in Phase 3 would start to).
- The `streamText` missing `abortSignal` finding pairs directly with the cost-control gaps found in Phase 2 (unenforced monthly cap, no alert cooldown) — cost-control across this app is consistently under-enforced relative to what the code's own comments claim.
