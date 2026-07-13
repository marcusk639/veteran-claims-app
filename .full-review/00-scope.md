# Review Scope

## Target

Full comprehensive review of the veteran-claims-app "Phase 1 Knowledge Assistant" feature, on branch `feat/phase1-knowledge-assistant` (worktree at `.worktrees/phase1-knowledge-assistant`, HEAD `bc8d954`). This is a Next.js 16 (App Router) application providing veterans with an authenticated chat assistant backed by a RAG knowledge base over an MCP tool server, with Clerk auth, Neon/Drizzle persistence, PostHog analytics, and cost alerting.

Goal: find gaps/issues/potential problems across the whole app, fix what's reasonably fixable now, and produce a fully documented backlog for anything not fixed so `/make-plan` can turn it into a plan.

## Prior Context (from session memory)

This branch already went through two rounds of targeted code review this session:

- Round 1 (Task 9 - cost alerting): found missing error handling around `recordMessageCost`/`checkCostAlert` in the chat route; fixed with try/catch + regression test; re-reviewed and approved.
- Round 2 (Task 10 - Knowledge Assistant chat/citations): found (a) missing `stopWhen` blocking multi-step tool-call synthesis, (b) an unreachable refusal branch, (c) unvalidated `conversationId` (auth/ownership gap). All three were fixed and independently re-reviewed as resolved; tests/tsc/build green as of commit bc8d954.

This full review should treat those as already resolved but verify independently rather than assuming — and should look at the _rest_ of the app (auth, DB layer, rate limiting, MCP client/tools, analytics, webhooks, config, tests, docs, CI/deploy) which has not had a dedicated pass yet.

## Files / Areas In Scope

- `src/app/api/chat/route.ts` + `route.test.ts` + `golden-questions.eval.ts` — chat endpoint, tool orchestration
- `src/lib/knowledge-tools.ts` + test — RAG/MCP tool wiring
- `mcps/localhost/mcp/*` — MCP client (ask, search_documents, get_document, list_sources, purge_source, trigger_sync, index, client)
- `src/lib/chat-system-prompt.ts` — system prompt / grounding rules
- `src/components/citation-pill.tsx` — citation UI
- `src/app/dashboard/chat/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/sourcing-standard/page.tsx`, `src/app/page.tsx`, `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/layout.tsx`
- `src/proxy.ts` (Next.js 16 middleware/proxy — auth gating)
- `src/db/schema.ts`, `src/db/index.ts`, `src/db/migrate.ts`, `src/db/conversations.test.ts`, `src/db/index.test.ts`
- `src/lib/env.ts`, `src/lib/rate-limit.ts`, `src/lib/usage.ts`, `src/lib/cost-alert.ts`, `src/lib/analytics.ts` + tests
- `src/app/api/webhooks/clerk/route.ts` + tests
- Config: `next.config.ts`, `drizzle.config.ts`, `playwright.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `.env.example`
- `package.json` / `pnpm-lock.yaml` (dependency posture)
- No CI/CD pipeline files exist in-repo yet (no `.github/workflows/`) — DevOps review should flag this as a gap rather than assume one exists.

## Flags

- Security Focus: no (but security is still covered under Phase 2 — this is a PHI/PII-adjacent (veteran claims) app so treat security findings with elevated weight)
- Performance Critical: no
- Strict Mode: no
- Framework: Next.js 16 (App Router), React 19, TypeScript, Drizzle ORM/Neon Postgres, Clerk auth, Vercel AI SDK v7, MCP (Model Context Protocol) client, PostHog

## Review Phases

1. Code Quality & Architecture
2. Security & Performance
3. Testing & Documentation
4. Best Practices & Standards
5. Consolidated Report
