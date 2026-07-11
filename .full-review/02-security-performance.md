# Phase 2: Security & Performance Review

## Security Findings

**Overall posture:** Core access-control primitives are correct — `auth()` re-checked in the route, `conversationId` ownership check is sound, rate-limit keys are per-user, the Svix webhook signature is verified, and destructive MCP tools (`purge_source`, `trigger_sync`) are deliberately withheld from the LLM tool surface. No Critical findings. The flagged prompt-injection → destructive-tool vector is **not currently exploitable** (destructive tools aren't in the model's tool surface and there's no exfil channel) — but keep it that way.

### High

- **H1. No schema validation on chat request body** (`route.ts:78`, `:97-102`, `:138`). Body is cast (`as ChatRequestBody`), never parsed. An authed user can forge fabricated `assistant`/`system` turns in `messages`, defeating the strict-grounding guarantee the system prompt enforces (dangerous in a VA-claims context — e.g. "Confirmed: you qualify for 100% rating"). Malformed/empty `messages` also crashes the route (uncaught 500), cheap to spam. **Fix: Zod-parse the body, restrict `role` to `"user"`, cap array length.**
- **H2. Unenforced abuse/cost cap** — the documented "40 msgs/month" cap is dead code (`usage.ts`'s `incrementUsage` has zero callers). The only live limiter is 40/minute ≈ 57,600 messages/user/day. Fixed-window limiter also permits ~2x burst at window boundaries. **Fix: wire `incrementUsage` to actually enforce the monthly cap before streaming; lower the per-minute ceiling; consider a sliding window.**

### Medium

- **M1. Cross-repo MCP results cast, not validated, then dereferenced unchecked** — `extractCitations` (`route.ts:45-61`) and the chat page (`page.tsx:44-49`) do unchecked property access on untrusted cross-service data; a malformed item (contract drift, or a misbehaving RAG service) throws server-side (silent persistence failure) or crashes the client render. **Fix: Zod-parse at the MCP tool-execute boundary, skip malformed items.**
- **M2. Committed default bearer token in `.env.example`** (`RAG_MCP_TOKEN=phase1-connectors-dev-token`) — unlike other placeholders this is a concrete working dev value that authorizes destructive MCP tools on the RAG side; lives in git history forever. **Fix: replace with a non-functional placeholder, rotate the real dev token, use distinct high-entropy per-env tokens.**
- **M3. No security response headers** (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) — `next.config.ts` has no `headers()`. For a PII-adjacent authed app this is a real misconfiguration gap.
- **M4. No audit logging of access-control decisions** — 401/429/403 responses in `route.ts` are silent; no way to detect IDOR probing or limiter abuse.

### Low

- L1: Invalid `conversationId` (non-UUID) hits Postgres uncaught → 500 (fixed for free by H1's Zod schema).
- L2: Destructive MCP tools remain importable in the app bundle, sharing the full-privilege token — defense-in-depth gap; scope a read-only token for the app.
- L3: `pnpm audit` shows moderate transitive dev/build-time advisories (`esbuild` via `drizzle-kit`, a `postcss` advisory via `next`) — not prod-exploitable, but worth bumping.

### Positives

- `conversationId` ownership check is correct object-level authz (no IDOR).
- Rate-limit key properly scoped per-user.
- Svix webhook verification correct, fails closed.
- Destructive tools withheld from the model surface.
- No `dangerouslySetInnerHTML`; React escaping neutralizes poisoned-RAG XSS.
- Secrets consistently accessed via `getRequiredEnv` (fail-fast), none hardcoded.

## Performance Findings

### Critical

- **1. `checkCostAlert` runs a full-table `SUM(cost_usd)` scan on every single chat message** (`cost-alert.ts:16-19`), against a `message_costs` table with no index on `created_at` and no retention/deletion anywhere in the codebase. O(n) per message where n = total messages ever sent app-wide. Negligible today, becomes a real per-request latency bottleneck as the table grows. **Fix: add an index; better, switch to a pre-aggregated rolling counter (same upsert pattern already used in `rate-limit.ts`).**
- **2. `onFinish` async work (message persistence, PostHog capture, cost recording, cost-alert webhook fetch) is not wrapped in `after()`** (`route.ts:144-176`) and can be silently killed by serverless function freeze after the stream's final chunk is flushed. The codebase already solved this exact class of problem correctly once, in `webhooks/clerk/route.ts` (`after(() => flushAnalytics())`) — this is the same footgun, unfixed in the chat route. **Impact: under real production load, risks silently dropping persisted assistant messages, analytics events, cost records, and cost alerts** — a correctness/data-loss bug, not just a latency issue. **Fix: wrap the tail side-effect work in `next/server`'s `after()`.**

### High

- **3. Cost-alert webhook has no cooldown/dedup** (`cost-alert.ts:25-31`) — once tripped, fires on every subsequent message until spend drops back below threshold; each fire is an awaited external fetch inside the per-message critical path. **Fix: add a cooldown gate (e.g. `last_alerted_at`).**
- **4. MCP client caches a rejected connection promise forever** (`mcps/localhost/mcp/client.ts:5-12`) — a transient MCP outage during a request can permanently poison a warm serverless instance (every later request on that instance gets grounded-refusal, even after the MCP server recovers, until the platform recycles the instance). An availability cliff disguised as graceful degradation. **Fix: clear the cached promise on rejection so the next call retries.**

### Medium

- 5. Missing indexes on `messages.conversation_id` and `conversations.user_id` — no `CREATE INDEX` anywhere in migration history; cheap to fix now, expensive as a live migration later.
- 6. Unbounded row growth with no retention policy on `rate_limit_windows`, `usage_counters`, `message_costs` — no cleanup job exists; compounds Finding #1's scan cost over time.

### Low

- 7. Sequential (rather than parallel) awaits for the rate-limit check and conversation lookup in the hot path — ~40-100ms of avoidable serial latency, low priority given LLM inference dominates request time.
- 8. Frontend (`chat/page.tsx`) has no virtualization on the message list — fine at current scale, will need windowing if conversations grow to hundreds of messages. No bundle-size concerns.
- Confirmed as _not_ a finding: the Neon `neon-http` driver choice is correctly sized for this stateless serverless workload.

## Critical Issues for Phase 3 Context

- H1 (unvalidated chat request body) and M1 (unvalidated MCP results) are directly relevant to the testing review — these are exactly the kind of boundary-input cases that should have dedicated tests but likely don't (existing tests assert on `res.json()` shapes the real client doesn't produce, per Phase 1's C2 finding).
- H2 (unenforced monthly cap) means `usage.ts`/`incrementUsage` is dead code with a test file (`usage.test.ts`) that may be testing an unused code path — worth the testing reviewer checking whether that test provides real coverage or false confidence.
- Performance Critical #2 (`onFinish` not wrapped in `after()`) is a silent-failure class of bug — the testing reviewer should check whether there's any test coverage for serverless-freeze/interrupted-completion scenarios (likely none, since this is hard to unit test — may need to be documented as an operational risk instead).
- Security M3 (missing security headers) and M2 (committed dev token) are both cheap, mechanical fixes appropriate to apply immediately rather than deferring to a backlog.
