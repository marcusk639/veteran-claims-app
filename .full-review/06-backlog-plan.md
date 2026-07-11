# Hardening Backlog — Implementation Plan

**Source:** `.full-review/05-final-report.md` (comprehensive review, 2026-07-08), sections "Defer to `/make-plan`" and "not implemented" items from Fixes Applied.
**Target:** `veteran-claims-app`, branch `feat/phase1-knowledge-assistant`, worktree `.worktrees/phase1-knowledge-assistant`.
**Already fixed this session (do not redo):** conversation persistence threading, dead MCP-failure branch removal, `after()` wrapping, Zod request validation on `/api/chat`, monthly usage cap enforcement, citation-extraction hardening, MCP client reconnect-on-rejection fix, cost-alert cooldown + index, missing DB indexes (`0004_cloudy_tomas.sql`), `get_document`'s `isError` fix, `migrate.ts` error handling, `abortSignal` on `streamText`.

Each phase below is self-contained and executable in a fresh chat context — it restates its own scope, cites exact doc sources gathered in Phase 0, and gives its own verification checklist. Run phases in order; later phases assume earlier phases' code exists (noted per-phase where it matters).

---

## Phase 0: Documentation Discovery (already done — summary for reference)

Four research passes were run against live/vendored docs before this plan was written. Cite these sources directly when implementing — do not re-derive from training data, and do not invent API shapes beyond what's below.

**Next.js 16 App Router (source: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`, `.../02-guides/content-security-policy.md`, `.../01-app/01-getting-started/15-route-handlers.md`, all vendored in this repo's `node_modules`):**

- Security headers go in `next.config.ts`'s async `headers()` function, NOT `vercel.json`. Shape: `headers(): Promise<Array<{source: string, headers: Array<{key: string, value: string}>}>>`.
- Route Handlers use the standard `export async function GET/POST(req: Request)` + `NextResponse.json(data, {status})` shape already used throughout this codebase (see `src/app/api/chat/route.ts`).
- Confirmed (again) this app's `middleware.ts`→`proxy.ts` rename is correct Next 16 convention.

**Vercel Cron (source: live Vercel docs via MCP `search_vercel_documentation`, https://vercel.com/docs/cron-jobs/manage-cron-jobs):**

- Use `vercel.json` (not `vercel.ts` — two docs disagreed on `vercel.ts`'s exact import shape; `vercel.json` has zero ambiguity and this project has no other Vercel-config needs).
- Shape: `{"crons": [{"path": "/api/cron/cleanup", "schedule": "0 0 * * *"}]}`.
- Vercel Cron authenticates by sending `Authorization: Bearer <CRON_SECRET>` — verify this header inside the route handler against a `CRON_SECRET` env var.

**Sentry (source: live docs.sentry.io, fetched 2026-07-09):**

- Current (post-v8) App Router layout: `instrumentation-client.ts` (NOT `sentry.client.config.js`, which is deprecated) + `sentry.server.config.ts` + `sentry.edge.config.ts` + `instrumentation.ts` (Next's instrumentation hook, dispatches by `NEXT_RUNTIME`) + `next.config.ts` wrapped in `withSentryConfig` + `app/global-error.tsx` for React render errors.
- Install: `npx @sentry/wizard@latest -i nextjs` is Sentry's own recommendation — it inspects the installed Next.js version and generates matching files, which is more trustworthy than hand-transcribing given this repo's Next.js 16 breaking-changes situation. Prefer the wizard over hand-writing.
- `Sentry.captureException(error)` in a route handler's catch block for explicit capture; uncaught errors auto-captured via `instrumentation.ts`'s `onRequestError` export.
- Gap: Sentry's docs never explicitly confirm Next.js 16 support. Run the wizard and trust its output over this plan's transcribed examples if they diverge.

**Clerk + Playwright (source: live clerk.com/docs, fetched 2026-07-09, URLs listed in Phase 6 below):**

- Official package: `@clerk/testing` (not yet installed). Playwright-specific helpers: `clerkSetup()` (mints a Testing Token, run once in global setup), `clerk.signIn({page, emailAddress})` (Backend-API sign-in, bypasses UI), `clerk.signOut`, `clerk.loaded`.
- Needs a `projects` array in `playwright.config.ts` (this project's current config has none) with a `global setup` project that `dependencies: [...]` chains into the real test project — Clerk's docs are explicit that the older `globalSetup` config function does NOT propagate the Testing Token correctly, only the `projects`+`dependencies` pattern does.
- Gap: `@clerk/testing`'s exact exported signatures weren't locally type-checked (package not yet installed) — confirm against installed types once added.

**rag-system cross-repo contract (source: direct file reads in `/Users/marcusklein/dev/rag-system`, 2026-07-09):**

- `RetrievalResult`/`SanitizedRetrievalResult` are plain hand-written TypeScript interfaces at `packages/core/src/types.ts:232-259` and `packages/core/src/metadata-policy.ts:84-88` — **no Zod schema exists on the rag-system side either**, and `@rag/core` is `"private": true` (workspace-internal, never published) so it cannot be imported cross-repo.
- **Conclusion: veteran-claims-app must hand-write and maintain its own Zod schema matching this contract** — there is no shared-package shortcut available. The exact fields to schema (everything passes through unsanitized except `document.metadata`, which is allowlist-narrowed to `{title, url, mimeType, sizeBytes, createdAt, modifiedAt, path, docClass}`):
  ```
  text: string, score: number, denseScore: number, sparseScore: number,
  document: { id, title, sourceId, sourceKind (enum), url?, hasOriginal?, metadata: {title?, url?, mimeType?, sizeBytes?, createdAt?, modifiedAt?, path?, docClass?} },
  chunk: { id, ordinal, headingPath: string[], page? }
  ```
- No MCP `outputSchema` is declared on any tool (`apps/mcp/src/tools/*.ts`) — the wire contract is prose-only in the tool description, confirmed via grep across all 6 tool files.
- rag-system's CI (`.github/workflows/ci.yml`) pins `pnpm/action-setup@v4` to `9.12.0` and `actions/setup-node@v4` to `node-version: 22`, uses `concurrency: {group: ci-${{github.ref}}, cancel-in-progress: true}`, `timeout-minutes: 15`, and runs build→typecheck→lint→test. Its separate `e2e.yml` adds a `services: {postgres: {image: pgvector/pgvector:pg16, ...}}` block with `pg_isready` health checks — that services-block pattern (not the docker-run parser-sidecar part, which doesn't apply here) is the template for veteran-claims-app's own CI, since `pnpm test` here hits a real Postgres DB per `vitest.config.ts`.

---

## Phase 1: CI/CD Pipeline — ✅ DONE (2026-07-10)

**What was implemented:** A GitHub Actions workflow gating every PR and push to `main` with build, typecheck, lint, and test. `.github/workflows/ci.yml`, `.github/dependabot.yml`, and a new `typecheck` script in `package.json` all landed and were verified locally (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`, all green, 37/37 tests).

**Correction to the original plan below — read before touching this phase again:** The plan as originally written (services.postgres, template borrowed from rag-system's `e2e.yml`) was **wrong** and was caught during implementation, not before. This app's DB client (`src/db/index.ts`) uses `drizzle-orm/neon-http` + `@neondatabase/serverless`'s `neon()` function, which speaks Neon's HTTPS proxy protocol — **not** the plain Postgres wire protocol. Confirmed by hand: `pnpm db:migrate` against a vanilla `postgres:16` Docker container fails with `NeonDbError: Error connecting to database: TypeError: fetch failed`. A `services: postgres:` block (rag-system's own pattern, which uses `pgvector/pgvector:pg16` over the wire protocol via a different driver) does not apply to this app.

**What actually works, and what's now implemented:** Two Neon-official options exist — `neondatabase/neon_local` (a Docker proxy service, but it still requires a real Neon account/API key AND requires driver code changes via `neonConfig.fetchEndpoint`/`neonConfig.poolQueryViaFetch` overrides, which would leak CI-only config into production `src/db/index.ts`) versus `neondatabase/create-branch-action` + `delete-branch-action` (creates/destroys a real ephemeral Neon branch per CI run — zero driver/app code changes needed, since the branch's connection string is a real Neon endpoint identical in shape to production). Went with the latter. The final `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk_test_Y2ktdGVzdC5wbGFjZWhvbGRlci5jbGVyay5hY2NvdW50cy5kZXYk
      CLERK_SECRET_KEY: sk_test_placeholder_ci_only_00000000000000000000
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: /sign-in
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Create ephemeral Neon branch
        id: create-branch
        uses: neondatabase/create-branch-action@fb620d43d4c565abaf088b848a4e28e5c4ea4d9c # v6
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          api_key: ${{ secrets.NEON_API_KEY }}
          branch_name: ci-${{ github.run_id }}
      - name: Export DATABASE_URL from the ephemeral branch
        run: echo "DATABASE_URL=${{ steps.create-branch.outputs.db_url }}" >> "$GITHUB_ENV"
      - run: pnpm db:migrate
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - name: Delete ephemeral Neon branch
        if: always()
        uses: neondatabase/delete-branch-action@4468d825d5a88ef4012f1705a82f02ec3072f776 # v3
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch: ${{ steps.create-branch.outputs.branch_id }}
          api_key: ${{ secrets.NEON_API_KEY }}
```

All third-party (non-`actions/`-org... actually including `actions/*` for consistency) actions are pinned to full commit SHAs with a version comment, per this repo's own semgrep security hook (`github-actions.security.third-party-action-not-pinned-to-commit-sha`), which fired and was fixed during implementation — re-pin if any action version needs bumping later, don't revert to `@v4`-style tags.

`.github/dependabot.yml` also got a `cooldown: { default-days: 7 }` block per each ecosystem entry, added after the same semgrep hook flagged the plan's original version (missing cooldown) as a MEDIUM finding (`dependabot-missing-cooldown`) — newly-published packages can be malicious/unstable, a 7-day wait is the hook's own recommendation.

**⚠️ Manual step required before this workflow can pass on GitHub — cannot be automated:** Two values must be added to this repo's GitHub settings (Settings → Secrets and variables → Actions) using a real Neon account with access to this project's actual Neon project:

- Repository **variable** `NEON_PROJECT_ID` (find in the Neon dashboard → Settings)
- Repository **secret** `NEON_API_KEY` (Neon dashboard → Account Settings → API keys)

Until these are set, the `Create ephemeral Neon branch` step will fail with an auth error — this is expected and not a bug in the workflow.

**Anti-pattern guards (still valid):**

- Do NOT invent a `CLERK_SECRET_KEY` that looks like a real production key — use an obvious placeholder; confirmed by hand that `next build` only needs it to be present and well-formed, not connected to a live instance (route tests already mock `@clerk/nextjs/server`'s `auth()`).
- Do NOT copy rag-system's docker-run parser-sidecar steps — this project doesn't have a parser service.
- Do NOT reintroduce a `services: postgres:` block for this app — see the correction above.

**Verification checklist:**

- [x] `pnpm typecheck` (new script) passes locally.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green locally, confirmed against a real ephemeral local Postgres container for the migration-failure diagnosis (then against the project's normal dev DB for the full suite, since the Neon-branch step can only be exercised on GitHub with real credentials).
- [ ] **Still needed (requires your action):** add `NEON_PROJECT_ID`/`NEON_API_KEY` to the repo's GitHub Actions secrets/variables, then push a branch and open a PR to confirm the `quality` job actually passes end-to-end on GitHub (the `create-branch`/`delete-branch` steps cannot be verified locally, only their YAML shape and the driver-compatibility problem they solve).
- [ ] Confirm the workflow's Postgres service actually gets migrated and tests pass against it, not against a stale cached DB.

---

## Phase 2: Security Response Headers + Audit Logging — ✅ DONE (2026-07-10)

Both 2a and 2b implemented exactly as planned, no surprises this time. Verified: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green (37/37 tests — 4 existing tests extended with `console.warn` assertions rather than new tests added, so the count is unchanged from Phase 1). Additionally ran `pnpm build && pnpm start`, then `curl -sI http://localhost:3000/` against the real running server and confirmed all four headers are actually present on the wire, not just configured:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

Audit logging (2b) landed on all four planned points (401, both 429s — rate limit and monthly cap, and 403) with `console.warn` including `userId`/`conversationId`/`monthlyCount` fields as appropriate, never message content/citations. Original planning notes retained below for reference.

**What to implement:** Two independent, small changes — global security headers via `next.config.ts`, and structured logging on the chat route's access-control decision points (401/403/429).

### 2a. Security headers

**Documentation reference:** Phase 0 above (`headers()` in `next.config.ts`, vendored Next.js 16 docs).

Copy this shape into `next.config.ts`, adapting the existing `turbopack.root` config (do not remove it):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

**Anti-pattern guard:** Do NOT add a full CSP in this pass — this app loads Clerk's and PostHog's scripts/iframes, and a misconfigured CSP will silently break auth or analytics. A CSP is a separate, higher-effort follow-up that needs testing against every third-party origin this app actually loads (Clerk, PostHog, Vercel AI Gateway) — track it as a follow-up, don't guess allowed origins here. HSTS/X-Frame-Options/X-Content-Type-Options/Referrer-Policy carry no such risk and are safe to ship immediately.

**Verification:** `pnpm build && pnpm dev`, then `curl -sI http://localhost:3000/` and confirm all four headers are present.

### 2b. Audit logging

**What to implement:** Structured `console.error`/`console.warn` (matching this codebase's existing logging style — no logging library is installed, and none is needed for this scope) at each access-control rejection point in `src/app/api/chat/route.ts`: the 401 (no `userId`), the 429 (rate limit / monthly cap), and the 403 (conversation ownership mismatch — this one is the IDOR-probe signal, prioritize it).

Example for the 403 path:

```ts
if (!existing || existing.userId !== userId) {
  console.warn("chat: forbidden conversation access attempt", {
    userId,
    conversationId,
  });
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
```

Apply the same pattern (adjust the message/fields) to the 401 and both 429 paths.

**Anti-pattern guard:** Do not log message content or citations — only IDs and outcome, to avoid logging PII/PHI-adjacent veteran claims content.

**Verification:** Add/extend `route.test.ts` assertions that `console.warn`/`console.error` is called with the expected fields on each rejection path (mirror the existing `consoleErrorSpy` pattern already used in that file for the cost-alert-failure test).

---

## Phase 3: Health Check + Error Tracking — 3a ✅ DONE, 3b ⏸️ DEFERRED (2026-07-10)

**3a implemented and verified exactly as planned**, no surprises. `src/app/api/health/route.ts` created, plus `route.test.ts` (2 tests: real-DB success path, mocked-failure 503 path with `vi.doMock`). Verified: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green (39/39 tests, up from 37). Also confirmed live against a real running server: `curl -s http://localhost:3000/api/health` → `{"status":"ok"}`, HTTP 200.

**3b deliberately skipped, by user choice.** The Sentry wizard (`npx @sentry/wizard@latest -i nextjs`) requires an interactive browser-based OAuth login to a Sentry account — same category of external-account dependency as Phase 1's Neon credentials, and no Sentry account/org exists yet for this project (confirmed: no `sentry-cli` installed, no `SENTRY_*` vars in `.env.local`/`.env.example`). When picking this phase back up: either run the wizard yourself interactively first (it needs your login, not something automatable), or revisit whether a lighter-weight alternative (e.g. keeping the existing `console.error` audit logging from Phase 2b as the only error-visibility mechanism, or a self-hosted GlitchTip instance using the same `@sentry/nextjs` SDK) fits better than full hosted Sentry. Original planning notes below are still accurate and usable whenever this resumes.

### 3a. Health check endpoint

**Documentation reference:** Phase 0 above (Route Handler shape from vendored Next.js 16 docs; DB client from this project's own `src/db/index.ts`).

Create `src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
```

**Anti-pattern guard:** Do not add auth to this route — health checks need to be reachable by an external uptime monitor without credentials. Do not include error details in the response body (information disclosure) — the 503 status code alone is the signal.

**Verification:** `pnpm dev`, `curl -s http://localhost:3000/api/health` returns `{"status":"ok"}` with a 200. Add a unit test mirroring the pattern in `src/db/index.test.ts`.

### 3b. Sentry error tracking

**Documentation reference:** Phase 0 above. **Run the wizard rather than hand-writing files** — it inspects the installed Next.js version (16.2.10) and generates matching output, which the research flagged as more trustworthy than transcribed doc examples given this app's Next.js 16 breaking-changes situation.

**Steps:**

1. `npx @sentry/wizard@latest -i nextjs` — follow its prompts (it will ask for a Sentry org/project; create a free-tier one if none exists, or point it at an existing org).
2. Review what the wizard generated against Phase 0's expected file list (`instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`, `next.config.ts` wrapped in `withSentryConfig`, `app/global-error.tsx`) — if the wizard produces something structurally different, trust the wizard's output (it matches the actually-installed Next.js version) over this plan.
3. Add explicit `Sentry.captureException(error)` calls in the catch blocks that currently only `console.error`:
   - `src/app/api/chat/route.ts`'s cost-alert-tracking catch block (currently just `console.error("cost-alert tracking failed", error)` — add `Sentry.captureException(error)` alongside it, don't replace the console.error).
   - Any other explicit try/catch added in Phase 2b.
4. Add `SENTRY_AUTH_TOKEN` to CI (Phase 1's workflow) as a repo secret if source-map upload in CI is desired — optional, can defer.

**Anti-pattern guard:** Do not skip the wizard and hand-transcribe the config files from this plan's Phase 0 notes — the research explicitly flagged medium confidence on Next.js 16 compatibility of hand-copied examples. Do not set `tracesSampleRate: 1.0` in production config (that samples every request) — the wizard's default of a lower prod rate is correct; only bump to `1.0` for `NODE_ENV === "development"`.

**Verification:** Trigger a deliberate error locally (e.g. temporarily throw in a route handler), confirm it appears in the Sentry dashboard, then revert the deliberate throw. Confirm `pnpm build` still succeeds with `withSentryConfig` wrapping.

---

## Phase 4: Retention/Cleanup Cron Job — ✅ DONE (2026-07-10)

**Implemented via TDD.** `src/app/api/cron/cleanup/route.ts` created (identical cutoff windows to the plan below: 1 day rate-limit windows, 90 days usage counters, 180 days message costs) plus `route.test.ts` (2 tests: 401-on-missing/wrong-bearer-token, and a real-DB seed-old-and-recent-rows test asserting only stale rows are deleted across all three tables). `vercel.json` added with the daily 03:00 UTC cron schedule. Verified: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green (41/41 tests, up from 39/39). Also manually verified against a running dev server with `CRON_SECRET` set: no header → 401, wrong header → 401, correct header → 200 with `{"status":"ok"}`.

**Deviation from plan, noted for future reference (not a bug):** with `CRON_SECRET` entirely unset (rather than merely wrong), the route currently 500s instead of 401ing, because `getRequiredEnv` throws before the header comparison runs. This only matters in a misconfigured environment (the manual `CRON_SECRET` step below was never completed) and is consistent with how `getRequiredEnv` is used elsewhere in this codebase (e.g. `DATABASE_URL`) — a loud failure on missing required config, rather than a silent wrong-auth response. Not changed since the plan's exact code has this same shape and revisiting it wasn't requested.

**⚠️ Manual step required (cannot be automated — blocked by this repo's `.env*` edit-protection hook):** add a `CRON_SECRET` entry to `.env.example` (generate a random value for real environments; Vercel's project env vars need it too, via dashboard or `vercel env add`). Until set, the deployed cron endpoint will fail every invocation.

Original planning notes below are still accurate and were followed as written.

**What to implement:** A scheduled cleanup route deleting stale rows from `rate_limit_windows`, `usage_counters`, and `message_costs`, triggered by Vercel Cron.

**Documentation reference:** Phase 0 above (`vercel.json` crons shape + `Authorization: Bearer` auth pattern, live Vercel docs).

**Steps:**

1. Create `src/app/api/cron/cleanup/route.ts`:
   ```ts
   import { NextResponse } from "next/server";
   import { lt } from "drizzle-orm";
   import { db } from "@/db";
   import { rateLimitWindows, usageCounters, messageCosts } from "@/db/schema";
   import { getRequiredEnv } from "@/lib/env";

   export async function GET(req: Request) {
     const authHeader = req.headers.get("authorization");
     if (authHeader !== `Bearer ${getRequiredEnv("CRON_SECRET")}`) {
       return new Response("Unauthorized", { status: 401 });
     }

     const now = new Date();
     const rateLimitCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day of windows is plenty
     const usageCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 3 months of usage history
     const costCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000); // 6 months of cost history

     await db
       .delete(rateLimitWindows)
       .where(lt(rateLimitWindows.windowStart, rateLimitCutoff));
     await db
       .delete(usageCounters)
       .where(lt(usageCounters.periodStart, usageCutoff));
     await db
       .delete(messageCosts)
       .where(lt(messageCosts.createdAt, costCutoff));

     return NextResponse.json({ status: "ok" });
   }
   ```
   (Retention windows above are a starting judgment call, not from any source doc — revisit once real usage volume exists; the important part is that a deletion job exists at all.)
2. Create `vercel.json` at the repo root:
   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }]
   }
   ```
   (Daily at 03:00 UTC — low-traffic hour, adjust once real traffic patterns are known.)
3. Add `CRON_SECRET` to Vercel's project env vars (via the Vercel dashboard or `vercel env add`, not `.env.example` since this is a generated secret, not a user-provided credential — though a comment in `.env.example` noting it's required would help onboarding; that edit is blocked by this repo's `.env*` protection hook, so flag it for manual addition rather than attempting it).

**Anti-pattern guard:** Do not delete `conversations`/`messages` rows in this job — those are user-facing chat history, not ephemeral rate-limit/cost-tracking state, and retention policy for actual conversation data is a product decision, not a mechanical cleanup task. Do not use `DELETE FROM ... ` raw SQL when Drizzle's query builder (`db.delete(table).where(...)`) works — stay consistent with the rest of the codebase's Drizzle usage.

**Verification:** Manually `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/cleanup` against local dev and confirm old rows are removed (seed some old-dated test rows first to verify the cutoff logic actually filters correctly, not just that the route returns 200). Add a unit test with `vi.mock`'d dates or manually inserted old rows, mirroring the DB-integration-test pattern already used in `rate-limit.test.ts`.

---

## Phase 5: Cross-Repo MCP Contract — Shared Zod Schema — ✅ DONE (2026-07-11)

**Implemented via TDD, with one deliberate deviation from the plan's exact code (see below).** `src/lib/retrieval-result-schema.ts` created with `sanitizedRetrievalResultSchema`/`SanitizedRetrievalResult`, matching rag-system's `SanitizedRetrievalResult` exactly (re-verified against `packages/core/src/types.ts:231-256` and `metadata-policy.ts:44-61` at implementation time — no drift since Phase 0's research). New `retrieval-result-schema.test.ts` (5 tests: valid parse, missing-required-field rejection, unknown-enum rejection, unknown-field stripping, optional-field handling). All three call sites now import this one schema: `route.ts`'s `extractCitations` (local `retrievalItemSchema` deleted), `search_documents.ts`'s `execute()`, and `page.tsx`'s citation-pill rendering (local `SearchResult` interface deleted, replaced with the imported `SanitizedRetrievalResult` type). Verified: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green (47/47 tests, up from 41). Grep sweep confirms zero remaining references to the old per-file interfaces and both `retrievalItemSchema`/`SearchResult` are gone.

**Deviation from the plan's literal code, noted for future reference (not a bug, a correction):** the plan's Phase 5 step 3 snippet for `search_documents.ts` was `z.array(sanitizedRetrievalResultSchema).catch([]).parse(...)`. That does not actually do what the plan's own prose says ("malformed items are dropped") — `z.array(...).catch(fallback)` fails the _entire array_ the moment any single element is invalid and replaces all of it with `[]`, silently discarding every valid result alongside the one bad one. Caught this before implementing (added a test for it: "drops individually malformed results while keeping valid ones"), and implemented per-item `safeParse` + filter instead, which is what the plan's prose actually describes. Same net effect for `route.ts`'s `extractCitations` (unchanged, already did per-item `safeParse`) — this correction only affects `search_documents.ts`, which previously had no validation at all.

Original planning notes below are still accurate for everything except that one snippet, and were otherwise followed as written.

**What to implement:** Replace the three hand-written, unvalidated interface copies (`McpRetrievalResult` in `route.ts`, `SearchResult` in `chat/page.tsx`, and the untyped cast in `search_documents.ts`) with ONE Zod schema, defined once and imported everywhere it's needed, matching rag-system's actual `SanitizedRetrievalResult` shape exactly (Phase 0 above has the authoritative field list).

**Documentation reference:** Phase 0 above — the exact field list for `SanitizedRetrievalResult`, confirmed by direct read of `rag-system/packages/core/src/types.ts:232-259` and `metadata-policy.ts:84-88`. No shared package exists (confirmed `@rag/core` is `"private": true`), so this schema must be hand-maintained in this repo and is NOT guaranteed to stay in sync automatically — that's an inherent limitation given rag-system's current architecture, not something this phase can fully solve.

**Steps:**

1. Create `src/lib/retrieval-result-schema.ts`:
   ```ts
   import { z } from "zod";

   // Mirrors rag-system's SanitizedRetrievalResult (packages/core/src/metadata-policy.ts:84-88),
   // which is the wire shape returned via MCP structuredContent.results. rag-system has no
   // Zod schema or published package for this type (it's workspace-private) -- this schema is
   // hand-maintained against that source and WILL drift silently if rag-system changes the shape
   // without a corresponding update here. Re-check against the source above if citations start
   // silently disappearing (this schema's safeParse-based callers drop, not throw, on mismatch).
   export const sanitizedRetrievalResultSchema = z.object({
     text: z.string(),
     score: z.number(),
     denseScore: z.number(),
     sparseScore: z.number(),
     document: z.object({
       id: z.string(),
       title: z.string(),
       sourceId: z.string(),
       sourceKind: z.enum([
         "sharepoint",
         "gdrive",
         "gmail",
         "outlook",
         "custom",
         "git-markdown",
         "ecfr-part4",
       ]),
       url: z.string().optional(),
       hasOriginal: z.boolean().optional(),
       metadata: z
         .object({
           title: z.string().optional(),
           url: z.string().optional(),
           mimeType: z.string().optional(),
           sizeBytes: z.number().optional(),
           createdAt: z.string().optional(),
           modifiedAt: z.string().optional(),
           path: z.string().optional(),
           docClass: z.string().optional(),
         })
         .partial(),
     }),
     chunk: z.object({
       id: z.string(),
       ordinal: z.number(),
       headingPath: z.array(z.string()),
       page: z.number().optional(),
     }),
   });

   export type SanitizedRetrievalResult = z.infer<
     typeof sanitizedRetrievalResultSchema
   >;
   ```
2. In `src/app/api/chat/route.ts`: replace the local `retrievalItemSchema` (currently a narrower ad-hoc schema covering only `text`/`document.title`/`chunk.headingPath`) with an import of `sanitizedRetrievalResultSchema` from the new file, and adjust `extractCitations` to read `.document.title`/`.chunk.headingPath`/`.text` off the fuller parsed shape (same field paths, no logic change needed beyond the import swap).
3. In `mcps/localhost/mcp/search_documents.ts`: replace the untyped `results: (result.structuredContent as {...})?.results ?? []` cast with `z.array(sanitizedRetrievalResultSchema).catch([]).parse(...)` so malformed items are dropped at the earliest point in the pipeline, not just at citation-extraction time.
4. In `src/app/dashboard/chat/page.tsx`: replace the local `SearchResult` interface with `import type { SanitizedRetrievalResult } from "@/lib/retrieval-result-schema"` and use it for the `part.output as {results?: SanitizedRetrievalResult[]}` cast (client-side rendering doesn't need runtime validation since it's re-displaying server-validated data, but should use the same type for consistency — this also closes original Low-priority finding #28, duplicated interfaces).

**Anti-pattern guards:**

- Do NOT invent an `outputSchema` on the MCP tool definitions in `mcps/localhost/mcp/` — Phase 0 confirmed rag-system declares no `outputSchema` on any of its 6 tools, so there's nothing to introspect/validate against at the protocol level; validation has to happen client-side (in this repo) against the hand-maintained schema above.
- Do NOT try to publish or import `@rag/core` as a package — confirmed private/workspace-internal, not available cross-repo.
- Do NOT make this schema `.strict()` — rag-system may add new fields to `RetrievalResult`/`SanitizedRetrievalResult` in the future, and a `.strict()` schema would start rejecting (rather than ignoring) previously-valid results the moment that happens. Zod's default (strip unknown keys) is correct here.

**Verification:** `pnpm test` — the existing `route.test.ts` and `search_documents.test.ts` tests should still pass with equivalent behavior (adjust any test fixtures that were relying on the OLD narrower schema's specific field subset, since the new schema requires more fields like `score`/`denseScore`/`sparseScore`/`sourceKind` be present — check `route.test.ts`'s "builds citations..." test fixture and add the now-required fields). `pnpm typecheck` confirms the shared type flows correctly through all three call sites.

---

## Phase 6: Authenticated E2E Test Coverage — ✅ CODE DONE, 🔴 SURFACED A REAL BUG (2026-07-11)

**Implemented:** `@clerk/testing` installed (`2.2.7`). `playwright.config.ts` updated with the `projects` array (`global setup` project running `tests/e2e/global.setup.ts`'s `clerkSetup()`, `chromium` project depending on it) — confirmed by direct inspection of the installed package's compiled source (`node_modules/@clerk/testing/dist/chunk-I4TOP4AO.mjs`) that `clerkSetup()` internally calls `dotenv.config({path: [".env.local", ".env"]})` by default, so it picks up this repo's existing `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY` with zero extra config. `tests/e2e/global.setup.ts` and `tests/e2e/authenticated-chat.spec.ts` created per the plan below. Verified: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green (unchanged at 47/47 — this phase adds no unit tests), plus `pnpm exec playwright test tests/e2e/auth.spec.ts tests/e2e/chat.spec.ts` (the two pre-existing unauthenticated specs) still pass unchanged under the new `projects` config.

**Correction to Phase 0's assumed API — read before touching this phase again:** Phase 0 flagged `@clerk/testing`'s exact signatures as unconfirmed; they're now confirmed by reading the installed package's `.d.ts` files and compiled source directly. The plan below (inherited from Phase 0) assumed `clerk.signIn({page, emailAddress})` needs a companion `E2E_CLERK_USER_PASSWORD` env var — **it does not, and never did.** That call signature is Clerk's _email-based ticket sign-in_: it looks the user up via the Backend API (`users.getUserList({emailAddress})`, using `CLERK_SECRET_KEY`), mints a one-time sign-in token (`signInTokens.createSignInToken`), and completes sign-in via the `ticket` strategy — no password field exists on that code path at all. Only `E2E_CLERK_USER_EMAIL` is used by `authenticated-chat.spec.ts`.

**Test user:** created via the Backend API (`@clerk/backend`'s `users.createUser`, using `CLERK_SECRET_KEY`, with a script run once and discarded — not committed) rather than the Clerk dashboard, with your explicit go-ahead first since it mutates external Clerk account state. Email `e2e-phase6+clerk_test@example.com` (Clerk's own documented `+clerk_test@` test-email convention; a `.test`-TLD email was tried first and rejected by Clerk's API validation as malformed, so this convention isn't optional cosmetic choice, it's what their validator accepts), created with `skipPasswordRequirement: true` since the ticket-based sign-in path never touches a password. `E2E_CLERK_USER_EMAIL` is a local-only env var for running this spec (not `.env.example`, blocked by the `.env*` edit-protection hook, same reasoning as CRON_SECRET in Phase 4).

**Test run results, and a real bug found:** ran `E2E_CLERK_USER_EMAIL=e2e-phase6+clerk_test@example.com pnpm exec playwright test tests/e2e/authenticated-chat.spec.ts` against local dev (no `rag-system` running, no `AI_GATEWAY_API_KEY` set locally — a known local-dev gap, original Low #41, tracked under Phase 7). Test 1 ("sign in, send a message, see an assistant reply render") **passes** — auth, conversation creation, and the request/response round-trip all work. Test 2 ("second message threads onto the same conversation") **fails**, and not because of a test bug: once `streamText`'s call to the AI Gateway throws (`GatewayAuthenticationError` in this run, but any `streamText` failure — rate limit, timeout, provider outage — would trigger the same code path in production), `useChat`'s `status` never returns to `"ready"`. `src/app/dashboard/chat/page.tsx`'s input and send button are gated on `status !== "ready"`, so they **stay disabled forever** after any failed model call, with no error message and no way to recover short of a page reload. The page snapshot at failure shows exactly this: an empty `assistant:` message shell rendered, input and button both `disabled`, no retry affordance anywhere. This is precisely the class of gap Phase 6 was written to surface (a real interaction path with no test coverage before now) — it is a genuine, previously-undetected UX/reliability bug, not an artifact of the local Gateway-auth gap. **Deliberately left unfixed here** — the two specs above were the full, explicitly-scoped Phase 6 deliverable, and choosing a recovery UX (auto-retry? a dismissible error banner? re-enable input immediately and let the next send retry?) is a product decision, not a mechanical fix; flagging it as a new backlog candidate rather than making that call unilaterally.

Original planning notes below are still accurate except for the password-env-var assumption corrected above, and were otherwise followed as written.

**What to implement:** At least one Playwright test that signs in as a real (test-instance) user and exercises the actual chat UI, closing the gap where Critical findings #1 (conversation persistence) and #2 (MCP-failure fallback) lived undetected by any test.

**Documentation reference:** Phase 0 above (`@clerk/testing` package, exact URLs listed there) — this is the single most doc-dependent phase; do not improvise API names not listed in Phase 0.

**Steps:**

1. `pnpm add -D @clerk/testing`.
2. In the Clerk Dashboard, confirm a dev instance exists with Email/Password auth enabled (this project's `.env.local` already has `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY` for a Clerk instance — confirm it's a dev instance, not production, before pointing tests at it). Create one dedicated test user's credentials.
3. Set `E2E_CLERK_USER_EMAIL` / `E2E_CLERK_USER_PASSWORD` as local env vars for running tests (document in a comment near the new test file, not `.env.example`, since these are test-only and adding them there is blocked by the repo's `.env*` hook anyway).
4. Update `playwright.config.ts` to add the `projects` array from Phase 0's exact example (global-setup project + chromium project with `dependencies: ["global setup"]`).
5. Create `tests/e2e/global.setup.ts` per Phase 0's exact example (`clerkSetup()` call).
6. Create `tests/e2e/authenticated-chat.spec.ts`:
   ```ts
   import { clerk } from "@clerk/testing/playwright";
   import { test, expect } from "@playwright/test";

   test("authenticated user can send a chat message and see a response", async ({
     page,
   }) => {
     await page.goto("/");
     await clerk.signIn({
       page,
       emailAddress: process.env.E2E_CLERK_USER_EMAIL!,
     });
     await page.goto("/dashboard/chat");
     await expect(page).not.toHaveURL(/sign-in/);

     await page
       .getByPlaceholder(/ask about your va disability claim/i)
       .fill("What is a DBQ?");
     await page.getByRole("button", { name: /send/i }).click();

     // The assistant's reply should render -- this is exactly the path where
     // Critical #1 (conversation persistence) and #2 (MCP-failure fallback
     // response shape) previously went undetected by any test.
     await expect(
       page.getByTestId("chat-messages").getByText(/assistant:/i),
     ).toBeVisible({ timeout: 15_000 });
   });

   test("a second message in the same session threads onto the same conversation", async ({
     page,
   }) => {
     await page.goto("/");
     await clerk.signIn({
       page,
       emailAddress: process.env.E2E_CLERK_USER_EMAIL!,
     });
     await page.goto("/dashboard/chat");

     await page
       .getByPlaceholder(/ask about your va disability claim/i)
       .fill("first question");
     await page.getByRole("button", { name: /send/i }).click();
     await expect(
       page.getByTestId("chat-messages").getByText(/assistant:/i),
     ).toBeVisible({ timeout: 15_000 });

     await page
       .getByPlaceholder(/ask about your va disability claim/i)
       .fill("follow-up question");
     await page.getByRole("button", { name: /send/i }).click();
     // Regression guard for the conversation-persistence fix (Phase 5 of the
     // original review's fixes) -- both exchanges should be visible in the
     // same message list, not a fresh/empty thread.
     await expect(
       page.getByTestId("chat-messages").getByText("first question"),
     ).toBeVisible();
   });
   ```
7. This project's live MCP dependency (`rag-system`) must be reachable for this test to get a real (not grounded-refusal) response — either run rag-system locally alongside this test (per this repo's own dev setup, not documented anywhere yet — see Phase 7's README task) or accept that the test may exercise the grounded-refusal path if the MCP server isn't running, and adjust the assertion to just check _some_ assistant response renders (any `assistant:` text) rather than asserting specific content, which is what the example above already does.

**Anti-pattern guards:**

- Do NOT use `clerk.signIn` against a production Clerk instance — confirm dev-instance status first (Phase 0 flagged this explicitly: code-based/OTP auth doesn't work this way in production, and Backend-API sign-in bypassing MFA is a dev-only pattern for test speed).
- Do NOT add `--disable-web-security` to any Playwright launch config — Phase 0 confirmed this breaks Clerk's Frontend API `Origin` header check.
- Do NOT use the older `globalSetup` Playwright config option — Phase 0 confirmed only the `projects`+`dependencies` pattern correctly propagates the Testing Token.

**Verification:** `pnpm exec playwright test tests/e2e/authenticated-chat.spec.ts` passes locally with rag-system running. Confirm the existing unauthenticated tests (`auth.spec.ts`) still pass unchanged.

---

## Phase 7: Documentation

**What to implement:** Three independent doc deliverables — README rewrite, an incident-response runbook, and a manual `.env.example` fix (blocked from automated editing).

### 7a. README rewrite

Replace the current create-next-app boilerplate `README.md` with:

- Prerequisites: Neon Postgres project, Clerk app (dev instance), a running `rag-system` MCP server (link to that repo, note the default `RAG_MCP_URL=http://localhost:3001/mcp`).
- Env var table mirroring `.env.example`'s existing comments (do not duplicate secrets, just document what each var is for and where to get it).
- Setup steps: `pnpm install` → `pnpm db:migrate` → `pnpm dev`.
- Test commands: `pnpm test` (needs `DATABASE_URL` set, hits a real DB), `pnpm eval` (needs live MCP + AI Gateway, the golden-questions eval suite — note it's NOT part of `pnpm test` and currently not run in CI, so it must be run manually or added as a separate non-blocking CI job later).
- One paragraph on the two-repo architecture: this app is the consumer, `rag-system` provides the MCP server with document connectors.
- A short "Next.js 16 migration notes" section listing the `middleware.ts` → `proxy.ts` rename as the first (and so far only) breaking change this app has already navigated (closes original Low-priority finding #42).

### 7b. Incident-response runbook

Create `docs/runbook.md` (new `docs/` directory) covering, at minimum:

- How to check if the `rag-system` MCP dependency is reachable (once Phase 3a's `/api/health` exists, extend it to also report MCP reachability, or document a manual check against `RAG_MCP_URL`).
- How to roll back a Vercel deployment (dashboard "Instant Rollback" or `vercel rollback` CLI).
- How to troubleshoot rate limiting (query `rate_limit_windows`/`usage_counters` directly if a user reports being incorrectly blocked).
- Escalation path (who/where — fill in with real contact info, this plan can't invent that).

### 7c. `.env.example` manual fix (cannot be automated)

This repo's global `.env*` edit-protection hook blocks Claude from editing `.env.example` directly. You (the human) need to manually:

1. Fix the stale comment referencing `src/middleware.ts` → `src/proxy.ts` (around the `NEXT_PUBLIC_CLERK_SIGN_IN_URL` entry).
2. Add a comment above `RAG_MCP_TOKEN=phase1-connectors-dev-token` flagging it as a real, currently-working dev credential that should be rotated before any shared/staging use (do NOT just swap in a fake placeholder — that value is presumably still needed to match `rag-system`'s dev `API_TOKENS` config for local development to keep working, per the original review's caution about this).
3. Add `CRON_SECRET` (from Phase 4) and, if using env-var-based DSN config, `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` (from Phase 3b) as documented entries.
4. Add `AI_GATEWAY_API_KEY` documentation (original Low-priority finding #41) — needed for local/non-Vercel dev since the Gateway resolves automatically on Vercel via OIDC but not elsewhere.

**Verification:** README renders correctly on GitHub (check code block formatting); a new contributor following it end-to-end (mentally or literally) should reach a running `pnpm dev` without needing to read any source file.

---

## Phase 8: Sourcing-Standard Page Accuracy

**What to implement:** This is a product decision, not a mechanical fix — the plan presents both options; pick one before implementing.

**Background:** `src/app/sourcing-standard/page.tsx` tells users every guide carries `last_verified` and `volatility` metadata, framed as something they can check per-answer. But `Citation` (`src/db/schema.ts`) and `CitationPill` (`src/components/citation-pill.tsx`) only carry `{source, section, snippet}` — no freshness fields flow from `extractCitations()` through to the UI. Today, users cannot actually verify per-citation freshness despite the page's copy implying they can.

**Option A — soften the copy** (low effort): Edit `sourcing-standard/page.tsx` to describe `last_verified`/`volatility` as an internal curation practice rather than something surfaced per-answer. Minimal, ships immediately, no schema/UI changes.

**Option B — build the plumbing** (medium effort): Extend the shared `sanitizedRetrievalResultSchema` from Phase 5 to also carry freshness metadata IF rag-system's `ExposedMetadata` allowlist includes it (Phase 0's research found `ExposedMetadata` includes `createdAt`/`modifiedAt` but did NOT confirm a `last_verified`/`volatility` field distinct from those — **verify this first** by re-checking `rag-system/packages/core/src/metadata-policy.ts:44-61`'s `ExposedMetadata` fields before committing to Option B, since the fields may not exist on the rag-system side at all, in which case Option A is the only viable choice regardless of preference). If confirmed available: thread the fields through `Citation` (schema + `extractCitations`) and `CitationPill` (render a small freshness indicator), then update the e2e test at `tests/e2e/chat.spec.ts:15` (which currently only checks the word "last_verified" appears on the static page) to instead check it's attached to a real citation.

**Recommendation:** Start with Option A (ship immediately, removes a live accuracy gap on a trust page) and revisit Option B as a separate feature once/if `rag-system` confirms it actually tracks and exposes this metadata per-document — don't build UI plumbing for a data field that may not exist upstream.

**Verification:** Whichever option is chosen, `pnpm test` and the Playwright `chat.spec.ts` suite should still pass (Option A needs a copy-only diff with no test changes; Option B needs the e2e test update described above).

---

## Phase 9: Code Quality Cleanup

**What to implement:** The remaining Low-priority items not already resolved by earlier phases (Phase 5 already resolved the duplicated-interfaces item, #28 — do not redo it here).

1. **Decompose `POST` in `src/app/api/chat/route.ts`** (original Medium #21) — extract `resolveConversation(userId, conversationId)`, `persistUserMessage(...)`, and `buildOnFinishHandler(...)` as named functions in the same file (no need for a separate module unless it grows further). Preserve all existing behavior and tests exactly — this is a pure refactor, verify via `pnpm test` showing identical pass/fail results before and after.
2. **`CitationPill` dark-mode variants** (original Low #31) — add `dark:` Tailwind variants to `src/components/citation-pill.tsx`'s `bg-slate-100 text-slate-700` classes (e.g. `dark:bg-slate-800 dark:text-slate-200`), matching whatever dark-mode convention the rest of the app uses (check `src/app/layout.tsx`/`globals.css` for the established pattern before picking colors).
3. **React list keys using array indices** (original Low #32) — `src/app/dashboard/chat/page.tsx:34,44` use `key={i}`/`key={j}`; switch to stable ids where available (`message.id` already exists for the outer map; for the inner `parts`/`results` maps, a stable key may not exist upstream — if not, array index remains the least-bad option for those specific inner lists, since parts/results don't get reordered within a single render; only fix the outer map if it isn't already using `message.id`, verify current code before changing).
4. **`stepCountIs(3)` magic number** (original Low #33) — extract to a named constant `const MAX_TOOL_CALL_STEPS = 3;` in `route.ts` with the existing comment preserved.
5. **Destructive MCP tools share the app's full-privilege token** (original Low #34) — this requires a change on the `rag-system` side (issuing a read-only scoped token) that's out of scope for this repo alone; document as a cross-repo follow-up rather than attempting a partial fix here.
6. **`messages.role`/`conversations.agentType` free text** (original Low #35) — convert to `pgEnum` if desired; low priority, requires a migration, low urgency since both are only ever written by this app's own code with a small fixed set of values.
7. **`packageManager` pin** (original Medium #25) — add `"packageManager": "pnpm@9.12.0"` to `package.json` (matching the version pinned in Phase 1's CI workflow and rag-system's own CI, for consistency across the stack).
8. **Dependency patch bumps** (original Low #37) — routine `pnpm update` for `react`/`react-dom`/`ai`/`@ai-sdk/react`/`@clerk/nextjs` patch versions; run `pnpm test && pnpm build` after to confirm nothing broke.
9. **Moderate transitive dependency advisories** (original Low #39, `esbuild` via `drizzle-kit`, `postcss` via `next`) — re-run `pnpm audit` at implementation time (versions will have moved since the original review) and address only what's still flagged.
10. **API contract doc comment** (original Low #38) — add a short doc comment block above `POST` in `route.ts` summarizing the request/response/error contract, now that Phase 1-8's changes have settled its final shape.

**Anti-pattern guard:** Do not batch all 10 of these into one giant commit — they're independent and low-risk individually; land them as separate small changes so a regression in any one is easy to isolate and revert.

**Verification:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` after each item (or batch of trivially-related items), not just once at the end.

---

## Final Phase: Verification

After all phases land (they don't need to land in a single session — this plan is designed to be executed incrementally across multiple sessions):

1. **Full check suite:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green.
2. **CI green on a real PR:** confirm Phase 1's GitHub Actions workflow passes on an actual pull request, not just local runs.
3. **E2E suite:** `pnpm exec playwright test` (all specs, both authenticated and unauthenticated) passes with `rag-system` running locally.
4. **Anti-pattern grep sweep:**
   - `grep -rn "as ChatRequestBody\|as SearchResult\|as McpRetrievalResult" src/` — should return nothing (Phase 5 removed all three).
   - `grep -rn "middleware.ts" .` (excluding `node_modules`) — should return nothing outside historical docs/comments explaining the rename (Phase 7a documents it explicitly, so a reference _inside that section_ is fine; anywhere else is a leftover).
   - `grep -rn "console.error" src/app/api/chat/route.ts` — should show the cost-alert catch block still has it (Phase 3b said "alongside", not "replacing").
5. **Re-read `.full-review/05-final-report.md`'s finding list against the current code** — spot-check that every item marked "deferred to `/make-plan`" in that report now has a corresponding Phase above, and every item this plan marks as done actually is (a quick `git log --oneline` since the review's HEAD `bc8d954` should show one commit per phase or per item, per Phase 9's anti-pattern guard about not batching).
6. **Update `.full-review/05-final-report.md`** (or add a new `.full-review/07-backlog-complete.md`) noting which phases from this plan were completed, mirroring the "Fixes Applied" section's format from the original review — so the audit trail stays continuous.
