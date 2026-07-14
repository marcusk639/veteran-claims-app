# Document Workspace — Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this design into a phased implementation plan, then superpowers:subagent-driven-development or superpowers:executing-plans to implement it task-by-task.

**Goal:** Implement per-claim Document Workspaces for `veteran-claims-app` — the "next central capability" already recommended by `veteran-disability-ai-resources/docs/superpowers/specs/2026-07-10-veteran-claims-platform-focus-design.md` (Phase 1) and refined by `veteran-disability-ai-resources/docs/superpowers/findings/2026-07-13-product-strategy-synthesis.md`. This spec resolves the implementation-level decisions those two documents left open (object storage provider, classifier choice, audit-log fix sequencing) and should be read as the concrete, buildable version of that Phase 1 recommendation — it does not re-litigate the product/legal analysis those documents already did.

**Architecture:** Veterans get organized, per-claim workspaces where they upload their own documents (decision letters, medical records, DBQs). The existing chat assistant retrieves across both the curated public knowledge base and the user's own uploaded documents, and provides general procedural guidance without case-specific tactics. Built entirely on existing `rag-system` infrastructure (the `custom` connector kind, `ObjectStore`/parser-sidecar pipeline, `AuthorizationScope.enforcedSourceIds` isolation) — no new retrieval plumbing.

**Tech Stack:** Next.js 16 (`veteran-claims-app`), the existing `rag-system` monorepo (Drizzle/Postgres/pgvector, MCP server, connectors, ingestion pipeline), Clerk auth, Vercel Blob (primary) or S3-compatible object storage (fallback — see §3).

## Global Constraints

(Carried forward unchanged from the platform-focus design — restated here since this doc is the operative spec going into implementation planning.)

- Never paywall basic claim knowledge or the Document Workspace capability itself — only scale (2nd+ workspace, storage ceiling) is ever gated.
- Never provide case-specific claim-strategy output (evidentiary-sufficiency opinions, drafted statement/nexus-letter content, exam tactics, witness-coordination guidance) as a scaled product feature. This is a hard line, not a style preference — see §5.
- Never let a shared change to `rag-system`'s packages break the CPA-firm product that shares the same infrastructure — any change to `packages/core`/`packages/ingestion`/`packages/services` must keep the CPA product's existing tests green. (The `VercelBlobObjectStore` addition in §3 is purely additive and doesn't touch the CPA product's code path.)
- Personal documents a user uploads must be retrievable only by that user — no cross-user retrieval, ever. Enforced via `AuthorizationScope.enforcedSourceIds`, not by convention.
- Never log or analytics-capture message content, retrieved document text, or query text for workspace-scoped interactions.

---

## 1. Problem Statement

`veteran-claims-app` currently has one feature: an authenticated knowledge-assistant chat (RAG-backed, citation-grounded), merged to `main` but not yet deployed to production, with no real usage data yet. The founder has chosen to spec Document Workspace now regardless of the original plan's "wait for real usage signal" gate, understanding that implementation timing should still track deployment/validation. This spec makes Document Workspace buildable: it resolves the object-storage provider, the document classifier, and the sequencing of a pre-existing cross-repo bug fix this feature's own audit-trail requirement depends on.

## 2. Data Model & Lifecycle

**New `workspaces` table** (`veteran-claims-app`):

- `id` (uuid, pk)
- `userId` (text, Clerk id — same pattern as `conversations.userId`)
- `name` (text — user-provided label, e.g. "PTSD Claim")
- `ragSourceId` (uuid, nullable — lazily created on first upload; an empty workspace doesn't need a backing `rag-system` source)
- `createdAt`/`updatedAt` (timestamptz)
- `deletedAt` (timestamptz, nullable — soft-delete timestamp)

**`conversations` gets a nullable `workspaceId` FK.** `null` = General chat (today's existing behavior, unchanged — retrieval scoped to public KB + eCFR only). Non-null = the chat route adds that workspace's `ragSourceId` to `enforcedSourceIds` for that conversation, using the same ownership-check pattern (403 on mismatch) already built for `conversationId` in `resolveConversation` (`src/app/api/chat/route.ts`).

**Both a General mode and named workspaces coexist**, switchable via a selector in the chat UI. Chosen over "every chat needs a workspace" (adds friction to the already-validated fast educational Q&A) and over "1 workspace = 1 conversation" (can't handle a veteran with multiple conditions needing a cross-cutting question). A veteran may have multiple workspaces (e.g., one per condition, mirroring how a real claim often bundles a primary condition with secondaries).

**Lifecycle:** create (empty, no `rag-system` source yet) → list (scoped to `userId`) → upload (lazily registers the `custom`-kind source on first document, pushes into `pending_uploads`) → delete.

**Delete: soft-delete, but retrieval exclusion is immediate.** Setting `deletedAt` must remove the workspace's `ragSourceId` from every future `enforcedSourceIds` computation at the same moment it's recorded — not at the eventual hard-purge. A "deleted" workspace still retrievable during the grace period is a data-isolation bug, not an acceptable interim state. Hard-purge (§7) happens later, on a grace period.

## 3. Object Storage

**Default: Vercel Blob.** Native to this app's deployment platform, simplest to provision (no new vendor relationship), supports private storage. Requires a new `VercelBlobObjectStore` in `rag-system/packages/rag/src/storage/`, implementing the existing `ObjectStore` interface (`packages/core/src/interfaces.ts` — a clean 3-method contract: `put(key, body, contentType?)`, `get(key)`, `delete(key)`, plus a `bucket` accessor). This is purely additive: a new file plus one extension to `config.ts`'s provider union type (currently `"none" | "s3"`, becomes `"none" | "s3" | "vercel-blob"`). Does not touch the existing `s3-object-store.ts` the CPA product uses.

**Fallback: provision a real S3-compatible bucket (AWS S3 directly, or Cloudflare R2 via its S3-compat API) and use the existing `s3-object-store.ts` unchanged.** Switch to this if, during implementation, Vercel Blob's SDK/auth model doesn't map cleanly onto the `ObjectStore` interface's `put`/`get`/`delete` semantics (e.g., streaming behavior, private-access token handling). This decision point should be resolved early in implementation — don't discover the mismatch deep into the feature.

Either way: encryption at rest uses envelope encryption (§4), not per-object/per-workspace KMS keys.

## 4. Document Classification & Encryption

**Classification: interim rule-based `ClassificationRuleSet`.** Per the existing `veteran-claims-app/docs/superpowers/specs/2026-07-11-classifier-adaptation-design.md` — a keyword/pattern-matching classifier satisfying `rag-system`'s minimal `DocumentClassifier` interface, fail-conservative (unmatched/ambiguous content defaults to the _highest_ sensitivity tier), every tier scoped `single-source-only`. Explicitly interim and swappable later for zero calling-code changes.

**Not adopted for this phase:** `doc-classifier` (the standalone Presidio+RAG+LLM classification service, built and pushed to `github.com/marcusk639/doc-classifier` since the original design was written). It's real and tested, but adopting it now means deploying its Fastify service + Docker Presidio sidecar and writing veteran-claims-specific config (prompt + reference KB) — real integration work that isn't justified before Document Workspace has any usage. Revisit once the interim classifier's limitations (no semantic nuance — can't recognize paraphrased sensitive content without keyword matches) actually bite in practice.

**Encryption: envelope encryption, not per-workspace KMS keys.** One platform-level CMK; per-workspace _data keys_ via `GenerateDataKey` (near-zero marginal cost vs. ~$1/mo/key flat for per-workspace CMKs, which would be $1,000/mo at 1,000 workspaces). Same crypto-shred-on-purge property: destroying the data key makes the ciphertext permanently unrecoverable. `pgvector` embeddings are partially invertible toward source content, so they also get volume-level encryption at rest, not just the source documents.

**Parser sidecar** (worst at-rest exposure point — plaintext in memory/temp files during parsing): require in-memory parsing where possible (or tmpfs + explicit unlink), disable core dumps, never log parsed content even at debug level.

## 5. Retrieval, Isolation & Legal Boundary

**Isolation — the single most important control in this design.** `AuthorizationScope.enforcedSourceIds` scopes every chat query to `[public KB sources, eCFR source, the requesting user's own relevant workspace source(s)]` and nothing else — never another user's workspace, regardless of workspace count. Existing, tested `rag-system` infrastructure; needs one addition: an automated test asserting cross-user retrieval returns zero rows (§11).

**Retrieval is top-k chunks only, never whole documents** — minimum-necessary disclosure, both for LLM egress (§6) and for the "explain the rule, don't assert a conclusion" boundary below.

**Legal boundary — extends the existing grounded-refusal pattern, not a new mechanism.** The chat route's existing deterministic `NO_GROUNDING_RESPONSE` rule gets a parallel system-prompt rule refusing case-strategy requests, redirecting to "talk to your VSO/accredited representative." Concretely:

- **Safe and in scope**: retrieving/summarizing the veteran's own uploaded documents; explaining general rules given what's in those documents; procedural navigation (how forms/processes work) without submitting anything on the veteran's behalf. Example: _"explain what 38 CFR 4.130 says about PTSD ratings."_
- **Out of scope, hard line**: asserting a conclusion about a specific claim's merits or evidentiary sufficiency; drafting the actual text of a personal statement or nexus letter; auto-filling/submitting VA forms; any fee structure contingent on claim outcome. Example: _"based on my uploaded records, is my evidence strong enough to win?"_ → refused, redirected.

## 6. Data Flow

1. Veteran uploads a document into a workspace.
2. Stored encrypted (Vercel Blob or S3/R2 fallback), per-workspace data key (§4).
3. Parsed by the existing parser sidecar (in-memory, no persisted plaintext temp files — §4).
4. Classified via the interim `ClassificationRuleSet` (§4).
5. Chunked/embedded, indexed as a personal, isolated source scoped to that one workspace.
6. Chat retrieval merges public KB + eCFR + the requesting user's workspace source(s) only, top-k chunks only (§5).
7. The assistant answers, staying on the safe side of the legal boundary (§5).
8. Every access (upload, retrieve, export, soft-delete, hard-purge) is recorded in the audit trail (§8) — never the query or document text itself.

## 7. Incident Response & Deletion Mechanics

Covers both ordinary user-initiated deletion and a legal/regulatory-driven response via the same mechanism:

- **Kill switch**: a feature flag (`DOCUMENT_WORKSPACE_INGESTION_ENABLED`) gates new uploads and workspace-scoped retrieval platform-wide. Disabling it stops new ingestion and drops all workspace sources from `enforcedSourceIds` computation immediately; existing conversations degrade to general-only rather than hard-failing.
- **Trigger**: legal counsel (or founder, monitoring the actively-evolving claims-accreditation litigation landscape) identifies a needed change — pre-launch (blocking) or post-launch (this policy).
- **Flow on trigger**: in-product notice + one-click export of the user's own documents (reusing `get_document`/object-store download) → workspace soft-deleted (retrieval exclusion immediate, §2) → grace period (default 30 days, pending final legal sign-off on the exact window) → background job hard-purges.
- **Hard-purge completeness**: must enumerate every sink — object storage, `pgvector` embedding rows, any parser-sidecar temp artifacts, the off-host audit-log sink, and any analytics system that received even metadata about the workspace. "Purged" that leaves a copy in one of these is not purged.
- **Pre-launch gate stays a hard gate**: no real user's sensitive document is ingested before legal review (§9) signs off. This policy covers "ground truth changed after we shipped," not "we skipped the gate."

## 8. Logging, Analytics & Audit Trail

**Prerequisite fix, recommended as its own standalone commit landing before Document Workspace work starts:** `rag-system/apps/api/src/routes/ask.ts:41` and `search.ts:72` currently store an _unsalted_ SHA-256 hash of the raw query string, believed to be anonymized. It isn't — low-entropy queries (a name, a date) are trivially recoverable, and a hash can't answer "who accessed what" anyway. This is a pre-existing bug affecting the CPA product today, independent of this feature, but workspace-scoped queries make the exposure worse (a query might contain "my MST assault on \<date\>"). Fix: for workspace-scoped queries, stop storing query text or its hash entirely — store `userId`, `workspaceId`, `action`, `documentId`/`chunkIds`, `timestamp` instead. Recommended to land standalone rather than bundled into this feature's branch, since it's an unrelated correctness/security fix with its own test/verification story.

**Analytics payload must be typed and allowlisted, not arbitrary properties.** `captureServerEvent(distinctId, event, properties?: Record<string, unknown>)` (`src/lib/analytics.ts`) currently accepts any shape. When workspace-chat analytics are added, define a strict typed payload of numeric/enum fields only (`inputTokens`, `outputTokens`, `retrievedCount`, booleans) — never message body or retrieved text.

**Audit trail covers the full document lifecycle**, not just ask/search: append-only rows for upload/ingest, retrieve, export, soft-delete, hard-purge, each capturing `userId + workspaceId + documentId + action + timestamp`. The off-host audit sink must inherit the same encryption/retention scope as the primary store, and its exported fields must not be joinable back to content by a lower-trust analytics system.

**LLM egress is the highest-sensitivity disclosure point.** MST/PTSD/SUD-adjacent snippets go into a third-party model's prompt. Confirm a zero-retention/no-training data-processing agreement with the LLM vendor; enforce minimum-necessary by retrieving only top-k relevant chunks, never whole documents (already stated in §5/§6, restated here as an explicit guardrail).

## 9. Applicable Data-Privacy Framework (launch gate, not code-verifiable)

HIPAA does not apply — this app is neither a covered entity nor a business associate (veterans upload their own previously-obtained records directly). What does apply:

- **FTC Health Breach Notification Rule (16 CFR Part 318)** — the primary real exposure. This app almost certainly qualifies as a "vendor of personal health records" (the same theory FTC used against GoodRx and BetterHelp). Required: a breach-notification plan meeting the 60-day/FTC-notification/affected-individual-notification standard.
- **Washington's My Health My Data Act (RCW 19.373)** — broad "consumer health data" definition, opt-in consent requirement, private right of action. Applies to any user in Washington regardless of company incorporation. Recommended as the nationwide default rather than geofencing.
- **FTC Act Section 5** — general unfair/deceptive-practices exposure, with explicit FTC scrutiny of veteran-targeted services. Required: affirmative express consent before sharing sensitive health data with any third party, no ad-tech sharing.
- **42 CFR Part 2** — does not bind this app in the "veteran uploads their own records" scenario, but its stricter posture is worth emulating as good practice for MST/SUD-adjacent content.

**This is an informal risk assessment, not formal legal advice.** Real legal review must confirm this analysis before Document Workspace ships to any real user — a hard gate, tracked explicitly, not a code-verifiable step.

## 10. Monetization Caps (scale only — never the feature itself)

| Feature             | Free | Plus ($7/mo, $59/yr) |
| ------------------- | ---- | -------------------- |
| Workspaces          | 1    | ~20 (soft cap)       |
| Documents/workspace | 8    | 40                   |
| Storage/workspace   | 30MB | 150MB                |

Document storage/re-indexing is a metered, accumulating cost (unlike flat-per-message chat) — the free tier needs this cap even before any pricing decision, for cost/abuse control, not because the underlying storage/embedding cost is actually significant at this scale (it isn't — well under $1/mo aggregate at 1,000 users). Never gate the workspace capability itself behind Plus — it's the differentiator, not the paywall.

## 11. Testing & Verification

- **Data-isolation test (highest priority, non-negotiable)**: automated test asserting one user's uploaded document is never retrievable by another user's query, given `enforcedSourceIds` is the sole isolation mechanism.
- **Immediate-exclusion-on-delete test**: verify a soft-deleted workspace's documents are excluded from retrieval the moment `deletedAt` is set, not at the eventual hard-purge.
- **Hard-purge completeness test**: verify a purged workspace leaves no recoverable copy across every enumerated sink (§7).
- **Analytics payload test**: verify any workspace-related PostHog event only ever contains typed/allowlisted numeric/enum fields, never message or document content.
- **Legal-boundary refusal test**: extend the existing golden-question eval with case-specific-request refusal cases ("is my evidence enough to win?", "write my personal statement for me"), parallel to the existing MCP-outage refusal tests.
- **Audit-log fix verification (§8)**: verify workspace-scoped query text/hash is never persisted, and the replacement fields are actually queryable for a real "who accessed what" answer.
- **CPA-product regression check**: existing CPA product test suite stays green after the `VercelBlobObjectStore` addition and any `DocumentClassifier` wiring.
- **Legal review sign-off**: required before shipping to any real user (§9) — track as a launch gate, not a code-verifiable step.

## 12. Explicitly Out of Scope

- Case-specific claim-strategy generation, evidentiary-sufficiency opinions, drafted statement/nexus-letter content, exam-tactics guidance, witness-coordination guidance.
- Auto-filling or submitting VA forms on a veteran's behalf.
- Any outcome-contingent pricing or fee structure.
- VA/B2G partnership or procurement pursuit.
- Case-management/dashboard tooling for VSOs.
- `doc-classifier` integration (§4) — revisit only once the interim classifier's limitations actually bite.

## 13. Open Questions Carried Forward

- Exact hard-purge grace-period length (default proposed: 30 days) — pending final legal sign-off.
- Whether Vercel Blob's adapter turns out clean or whether the S3/R2 fallback (§3) is needed — resolve early in implementation, not deep into the feature.
- Deployment/usage-validation timing relative to this feature's implementation — the founder has chosen to spec this now despite the original plan's "wait for usage signal" gate; implementation sequencing relative to deployment is a separate decision from this spec.
