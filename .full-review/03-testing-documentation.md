# Phase 3: Testing & Documentation Review

## Test Coverage Findings

**Test run:** `pnpm test` (vitest) — 13 files, 30 tests, all passing. Several "unit" tests (`rate-limit.test.ts`, `usage.test.ts`, `cost-alert.test.ts`, `conversations.test.ts`, `db/index.test.ts`) are true integration tests against a real Postgres DB via `DATABASE_URL`. Playwright e2e: only 2 spec files / 3 tests, all unauthenticated redirect/static-page checks — **no authenticated E2E coverage of the chat UI exists at all.** `golden-questions.eval.ts` is a real eval harness (not a stub) exercising live `streamText` + MCP retrieval, but is gated behind `pnpm eval` and not part of the default test run — worth confirming it's wired into CI as a separate job, or it's dead weight.

The suite is green, but "green" is misleading: several critical code paths are structurally invisible to every test in the repo.

### Critical

- **1. The conversation-persistence round-trip gap (Phase 1 finding) is undetectable by any test.** All `conversationId` tests in `route.test.ts` construct raw `Request` objects by hand — none exercise the real `useChat`/`DefaultChatTransport` client config, which is the actual site of the bug. No E2E test drives an authenticated chat session either.
- **2. The MCP-failure fallback test validates the wrong thing.** `route.test.ts:197-223` asserts on `res.json()` for the fallback path, proving the raw `Response` is well-formed JSON — but says nothing about whether `DefaultChatTransport` (which expects an SSE UI-message stream) can actually consume it. Confirmed as a genuine test/implementation mismatch, not a false alarm.

### High

- **3. `usage.test.ts` gives false confidence over dead code.** `incrementUsage`'s only caller in the entire repo is its own test — it is not wired into `route.ts`. The test's concurrency coverage is solid but tests a code path no real request ever takes.
- **5. Zero runtime request validation, zero adversarial-input tests, plus a new confirmed crash bug.** No `zod` usage anywhere in `src/`; `route.ts:78` does a bare type assertion on the request body. No test sends a forged `assistant`/`system`-role message, an empty `messages` array with `conversationId` set, or a malformed `conversationId`. **New bug confirmed by static analysis:** a non-UUID `conversationId` will throw an unhandled Postgres `invalid input syntax for type uuid` error at `route.ts:82-85` (no try/catch), surfacing as a raw 500 instead of a clean 400 — untested and unhandled.

### Medium

- **4. `onFinish`'s missing `after()` wrapper (Phase 2 Performance Critical #2) is a real risk but only partially testable** with the current mocked-`streamText` harness — `onFinish` always runs to completion in tests regardless of real serverless freeze semantics. The webhook route's `route.after.test.ts` pattern (mock `after`, assert it's called, manually invoke the callback) is directly reusable for the chat route once the fix lands. Until then, recommend documenting this explicitly as an operational risk rather than expecting a unit test to close the gap.

### Additional observations

- Test pyramid is unit/integration-heavy with almost no E2E weight, inverted relative to risk given the client/server contract (findings 1-2) is the highest-risk surface.
- DB-touching integration tests don't tear down inserted rows — confirm `DATABASE_URL` in dev points to a disposable test DB, not shared dev seed data.
- The ownership-check path (403 for another user's `conversationId`) is well-tested at the unit level — solid, in contrast to the request-validation gap.
- `rate-limit.test.ts` only tests sequential calls; a `Promise.all` concurrency variant (mirroring `usage.test.ts`'s pattern) would better validate the fixed-window counter under real concurrent load.

## Documentation Findings

### Critical

- **1. README.md is unmodified `create-next-app` boilerplate** — zero project-specific content. Documents none of: required env vars, the two-repo architecture (this app + `rag-system`'s MCP server), `db:generate`/`db:migrate`, or the `pnpm eval` golden-questions suite. A new contributor cannot get the app running from the README alone.
- **2. No documentation of the two-repo split or the MCP transport/codegen contract.** `mcps/localhost/mcp/*.ts` is auto-generated from `rag-system`'s MCP server with hand-fixes documented only in an inline comment inside `search_documents.ts` ("reapply after any regeneration") — the warning most likely to be lost on the next regen has no pointer from README or AGENTS.md.

### High

- **3. Misleading comment in `route.ts:114-116`** — describes the MCP-failure catch as handling "MCP connection failure," but `getKnowledgeTools()` is synchronous and cannot throw for that reason; the real failure handling lives inside each tool's `execute()`. Same dead-code/misleading-comment issue independently flagged by the code-quality reviewer in Phase 1 (H1) — now confirmed a third time from the documentation-accuracy angle.
- **4. Comment vs. code mismatch on the usage cap** — `route.ts:25`'s comment is technically self-consistent but gives no signal that the monthly cap (`usage.ts`) is entirely unwired. A reader has no way to know without grepping for callers.
- **5. `.env.example`'s `RAG_MCP_TOKEN` ships a real working dev credential** presented like a normal placeholder, with no rotation instruction — documentation angle on Security M2. Every other value in the file is an obvious placeholder; this one is silently different.

### Medium

- **6. NEW — `sourcing-standard/page.tsx` promises per-citation freshness metadata (`last_verified`, `volatility`) the app has no way to surface.** The `Citation` type (`schema.ts:39-43`) and `CitationPill` component carry only `{ source, section }` — no freshness fields flow from `extractCitations()` through to the UI. The trust page's copy is accurate about internal methodology but reads as though users can check freshness on any given answer; today they can't. Only the e2e test checks that the word "last_verified" appears on the static page, not that it's ever attached to a real citation. **This is a user-facing accuracy gap on a trust/credibility page for a veteran-facing product** — worth weighing seriously.
- **7. No note anywhere on the Next.js 16 `middleware.ts` → `proxy.ts` rename** this app already correctly navigated — AGENTS.md's generic warning doesn't log which specific breaking changes were already hit and fixed, inviting future rediscovery by trial and error.

### Low

- 8. No API contract documentation for `POST /api/chat` (request/response/error shapes) — low severity since it's an internal single-consumer endpoint, but a short doc comment would help future frontend consumers.
- 9. Inline comments are otherwise a genuine strength (`search_documents.ts`, `chat-system-prompt.ts`, `cost-alert.ts`) — the problem is the specific misleading/stale ones (#3, #4) and the absence of any doc layer above individual files (#1, #2), not comment density generally.

## Cross-Phase Convergence

Three independent reviewers (Phase 1 code-quality, Phase 3 testing, Phase 3 docs) all separately flagged the same misleading `route.ts:114-116` comment/dead-code pair — very high confidence this is a real issue worth fixing, not a one-reviewer artifact. Similarly, the conversation-persistence gap and the MCP-fallback response-shape mismatch are now confirmed by four independent passes (quality, architecture, testing, and implicitly docs via the usage-cap comment pattern).
