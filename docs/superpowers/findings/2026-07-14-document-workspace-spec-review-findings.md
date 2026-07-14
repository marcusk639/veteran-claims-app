# Document Workspace Spec — Plan Review Findings

**Reviewed document:** `docs/superpowers/specs/2026-07-14-document-workspace-design.md` (commit `95767e2`)
**Review date:** 2026-07-14
**Review method:** `/plan-review` skill (six-lens framework: correctness, completeness, risk, hidden assumptions, sequencing/parallelism, scope creep), with technical claims independently verified against `rag-system`'s actual source rather than taken from the spec's prose.
**Verdict at time of review:** Needs clarification (not a rework) — architecture, isolation model, and legal-boundary intent are sound; the issues below are about tightening ambiguous or under-verified points, not structural problems.

**Purpose of this document:** every issue found in the review, in enough depth that a session with zero prior context on this conversation can pick any one item, understand exactly what's wrong and why it matters, and resolve it — updating the spec file directly once resolved. This document should be treated as a checklist against the spec, not a permanent record — once an item is resolved in the spec, mark it resolved here too (see "Resolution Tracking" at the bottom) so this doesn't drift into being read as still-open when it isn't.

---

## How to use this document

1. Work through "Critical Issues" first — these should be resolved (by editing the spec) before this goes to `writing-plans`.
2. "Questions / Assumptions to Verify" need an actual answer (via code inspection, a spike, or asking the founder) before implementation starts, even if the spec itself doesn't change as a result.
3. "Suggestions" are non-blocking — improve the spec if there's time, but don't let them gate progress.
4. For each item, the spec section it applies to is named explicitly (e.g. "§5") so you can jump straight to it in the reviewed document.
5. After resolving an item, update the "Resolution Tracking" table at the bottom of this doc — don't delete the finding, mark it resolved with a one-line note on how.

---

## Critical Issues

### C1. Legal-boundary refusal mechanism is weaker than the spec's language claims

**Spec location:** §5 ("Legal boundary — extends the existing grounded-refusal pattern, not a new mechanism")

**What the spec says:** "The chat route's existing deterministic `NO_GROUNDING_RESPONSE` rule gets a parallel system-prompt rule refusing case-strategy requests... the same deterministic mechanism that already enforces grounded-refusal today, not a new ad-hoc check."

**Why this is a problem:** The word "deterministic" is doing more work than it's earned. The _existing_ `NO_GROUNDING_RESPONSE` behavior is genuinely deterministic because it's anchored to a code-level, checkable fact: retrieval returned zero results, so the code path can force a canned refusal without the model ever having a choice in the matter. A "refuse case-strategy requests" rule has **no equivalent code-level signal to key off of** — there's no way to mechanically detect "this question is asking me to evaluate evidentiary sufficiency" the way you can mechanically detect "zero search results came back." The only enforcement mechanism available is the system prompt instructing the model to refuse, verified after the fact by eval test cases. That's meaningfully weaker than what "deterministic... not a new mechanism" implies, and the spec should not imply otherwise.

**Why it matters enough to be Critical, not a Suggestion:** This is the single highest-stakes guardrail in the entire feature. Per the parent design docs (`veteran-disability-ai-resources/docs/superpowers/specs/2026-07-10-veteran-claims-platform-focus-design.md` §4.1 and the 2026-07-13 product-strategy-synthesis finding), three real competitors (Trajector, VA Claims Insider, Veterans Guardian) are facing **active 2026 litigation** for functionally this exact pattern — telling a veteran whether their evidence is strong enough, in some form — and a federal court has **already ruled one company's model illegal**. If this app's version of that same guardrail is "a system prompt line plus a couple of eval cases," and a user phrases a question in a way the model doesn't recognize as case-specific (paraphrase, multi-turn erosion, indirect wording — "so realistically, would a rater see this the way I do?"), the app could produce exactly the output that's getting other companies sued, with no code-level backstop that would have caught it.

**Recommended resolution (pick one, or propose an alternative and document the choice):**

- **(a) Defense-in-depth via a second pass.** Before the main model responds, run the user's _question_ (not the retrieved content) through a narrower, purpose-built classifier or a second cheap LLM call whose only job is "does this question ask for a case-specific conclusion about a specific veteran's evidence?" If yes, short-circuit to the refusal message deterministically — same pattern as `NO_GROUNDING_RESPONSE`'s code-level short-circuit, just gated on a different signal. This is more engineering work but actually earns the word "deterministic."
- **(b) Substantially larger adversarial eval set, explicitly scoped to this risk.** If (a) is deferred, at minimum replace the "two example refusal test cases" currently implied by §11 with a real adversarial set: direct requests, paraphrases, multi-turn erosion (ask an innocuous question, then a follow-up that narrows toward case-specificity), indirect/hedged phrasing ("just curious, not asking for advice, but..."), and requests embedded inside a longer message. Size this proportionally to the legal exposure, not as an afterthought next to the MCP-outage refusal tests it's currently listed alongside.
- Either way: **update §5's language** so it no longer claims equivalence with the grounded-refusal mechanism's determinism. State plainly what the actual enforcement mechanism is and what its known failure mode is (LLM instruction-following can be gotten around; here's how we're mitigating that).

**Who should resolve this:** Whoever picks this up should re-read `veteran-disability-ai-resources/docs/superpowers/specs/2026-07-10-veteran-claims-platform-focus-design.md` §4.1 in full before deciding — it has more detail on the exact enforcement mechanism this is meant to parallel, and on the specific competitor litigation this is trying to avoid repeating.

---

### C2. Legal review is scheduled too late in the process

**Spec location:** §9 ("Applicable Data-Privacy Framework... a hard gate before Document Workspace ships to any real user") and §11 ("Legal review sign-off: required before shipping to any real user")

**What the spec says:** Legal review happens as a gate right before shipping to real users — i.e., after implementation is essentially complete.

**Why this is a problem:** This isn't a new insight — the parent platform-focus design's own prior review round (§ referenced in that document's own revision history) already flagged "parallel legal review kickoff (not end-of-phase gate)" as a needed correction to an earlier draft. This spec doesn't carry that correction forward; it reverted to gating legal review at the very end again.

**Why it matters:** Reviewing a design document costs a lawyer an afternoon. Discovering a legal blocker after weeks of engineering work on a data model, storage encryption scheme, isolation mechanism, and incident-response automation is enormously more expensive to unwind — and in the worst case, could force reworking the core data model (e.g., if legal counsel decides the workspace-per-claim structure itself needs to change, or that a particular data category can't be accepted at all).

**Recommended resolution:** Get this spec (or at minimum, §5 legal boundary + §9 data-privacy framework) in front of real legal counsel **now**, in parallel with implementation starting — not as a pre-launch gate at the end. Update §9/§11 language to reflect "legal review kicks off in parallel with implementation, sign-off required before any real user's data is ingested" rather than implying review only happens once code is ready.

**Who should resolve this:** This is a process/scheduling decision for the founder, not something an engineering session can resolve unilaterally — flag it to them directly if picking this up, don't just edit the spec's wording without their buy-in on actually doing the parallel review.

---

### C3. `enforcedSourceIds` cardinality is internally inconsistent between §2 and §5/§6

**Spec location:** §2 ("`conversations` gets a nullable `workspaceId` FK") vs. §5 ("the requesting user's own relevant workspace **source(s)**") and §6 step 6 ("the requesting user's workspace **source(s)** only")

**What the spec says, precisely:**

- §2: a `conversation` has **one** nullable `workspaceId` — singular. The spec explicitly rejects "1 workspace = 1 conversation" as too rigid, but the resolution it lands on is still "each conversation points at zero or one workspace," not "a conversation can span multiple workspaces."
- §5 and §6 both describe retrieval scope using the plural "workspace source**(s)**" — implying a single conversation's retrieval could span more than one workspace at once.

**Why this is a problem:** Given the data model in §2, a single conversation can only ever have one `workspaceId` attached. So where does "source(s)" (plural) come from? Two possibilities, and the spec doesn't say which is true:

1. It's leftover wording from an earlier draft that considered letting one conversation query across multiple workspaces at once, and that idea got cut from the data model but not fully scrubbed from the retrieval-scope prose.
2. It's intentional — maybe "source(s)" is meant to cover the case where a single workspace, once it has multiple uploaded documents, produces multiple underlying "sources" in `rag-system` terms (as opposed to multiple _workspaces_). If that's the intent, the wording is ambiguous rather than wrong, but it still needs to be stated unambiguously, because "workspace source(s)" reads naturally as "one or more workspaces' sources," not "one workspace's one-or-more underlying source records."

**Why it matters enough to be Critical:** This is exactly the kind of ambiguity that becomes a real cross-user or cross-workspace isolation bug if two different people (or the same person on two different days) implement `enforcedSourceIds` computation against two different mental models of what it's supposed to include. Given isolation is explicitly called out elsewhere in the same spec as "the single most important control in this design," leaving its exact scope ambiguous is a direct contradiction of that stated priority.

**Recommended resolution:** Before implementation starts, explicitly resolve and restate:

- Confirm (with the founder, since it may be a product decision, not just a wording fix) whether a single conversation's retrieval should ever include more than one _workspace's_ documents at once, or whether it's strictly "General scope, or exactly one workspace's scope, never a blend."
- If it's strictly one-workspace-or-none (which matches §2's data model and seems to be the actual intent based on the "avoids cross-cutting friction via workspace switching, not blending" framing earlier in the design conversation that produced this spec): reword §5 and §6 to say "the workspace attached to this conversation, if any" (singular), and clarify that "source(s)" plural, if kept, refers to that one workspace's potentially-multiple underlying document sources, not multiple workspaces.
- Either way, this resolution should land as an edit to the spec file itself, not just a decision recorded in this findings doc — the spec is the thing `writing-plans` will actually consume.

---

## Questions / Assumptions to Verify

### Q1. Does the existing parser sidecar support OCR? (High priority — verify before committing to current parser-reuse plan)

**Spec location:** §4 ("Parser sidecar"), §6 step 3 ("Parsed by the existing parser sidecar")

**The assumption:** The spec assumes the existing `rag-system` parser sidecar can be reused as-is for Document Workspace uploads.

**Why this needs verification, not just an assumption:** Decision letters and medical records — the two document types named explicitly in the spec's own Architecture section as what veterans will upload — are frequently **scanned images or image-based PDFs**, not text-native PDFs. If the parser sidecar does text extraction only (no OCR), a large fraction of what veterans actually upload in practice will fail to parse or will parse as empty/garbage text, silently undermining the entire feature's value proposition without any obvious error surfaced to anyone.

**How to verify:** Read the parser sidecar's actual implementation (check `rag-system` for whatever service/package handles document parsing — search for where `pending_uploads` rows get processed into parsed text) and confirm whether OCR is in the pipeline. If not, this needs to be flagged as a real scope item (add OCR, e.g., via a hosted OCR API or a library) — not something to discover after launch when veterans' scanned decision letters silently fail to produce any useful citations.

### Q2. How does a `"failed"` `pending_uploads` status surface to the user?

**Spec location:** Not addressed anywhere in the spec's data flow (§6) or lifecycle (§2) sections.

**What's verified true:** `rag-system`'s `pending_uploads` table (`packages/db/src/schema.ts:294-320`, confirmed by direct read) already models a `status` column with values `"pending" | "ingested" | "failed"`. So the underlying infrastructure already has a place to record a parsing/ingestion failure.

**What's missing:** The spec never describes what happens on the `veteran-claims-app` side when a document lands in `"failed"` status. Does the veteran see any indication their upload didn't work? Is there a retry affordance? Does it just sit invisible, making the veteran think their document was successfully added when it wasn't (a real trust/UX problem for a product whose whole pitch is transparency)?

**How to resolve:** Add an explicit subsection to §2 (Lifecycle) or §6 (Data Flow) describing the failed-upload user experience. At minimum: the workspace UI should be able to show a document's status (pending/ingested/failed) and give the user _some_ signal and recourse for a failed one.

### Q3. Implementation trap: `rag-system`'s object-store factory does not exhaustively switch on `provider`

**Spec location:** §3 (Object Storage — `VercelBlobObjectStore` addition)

**What's verified true (read directly, not inferred from the spec):** `rag-system/packages/rag/src/storage/factory.ts:16-34`:

```ts
export function createObjectStore(
  cfg: Config["objectStore"],
): ObjectStore | null {
  if (cfg.provider === "none") return null;
  if (!cfg.bucket) {
    throw new ValidationError(
      "OBJECT_STORE_BUCKET is required when OBJECT_STORE_PROVIDER=s3",
    );
  }
  return new S3ObjectStore({ ... });
}
```

Note precisely what this does: it checks for `"none"` explicitly, then **falls through unconditionally to constructing an `S3ObjectStore`** for literally any other value of `provider` — there is no `else if (cfg.provider === "s3")` branch. The factory's own doc comment (lines 11-14) spells out the intended process for adding a new backend: "1. Implement `ObjectStore` in a new file, 2. Add a case here, 3. Add its enum value to `Config.objectStore.provider`."

**Why this is a real trap, not a hypothetical one:** If the implementation work widens `Config.objectStore.provider`'s type to include `"vercel-blob"` (per this spec's §3) but the engineer doing that work doesn't separately remember to add a branch to `factory.ts`, **TypeScript will not catch the mistake** — there's no exhaustiveness check (no `switch` with a `never` fallthrough, just sequential `if`s). The result: setting `OBJECT_STORE_PROVIDER=vercel-blob` would silently construct an `S3ObjectStore` populated with Vercel Blob's config values (wrong shape entirely — Vercel Blob doesn't use bucket/region/access-key-id/secret-access-key the way S3 does), which would fail at **runtime**, and fail in a way that's confusing to debug (an S3 client complaining about bad credentials, not an obvious "unknown provider" error).

**How to resolve:** When implementing §3, treat "add a case to `factory.ts`" as its own explicit, separately-tracked task — not something assumed to happen automatically as part of "implement the `VercelBlobObjectStore` class." Consider also fixing the factory itself to use an exhaustive switch (with a `default: throw` or a `never`-typed exhaustiveness check) as a small defensive improvement while touching this code, so the next backend addition doesn't have the same silent-fallthrough risk — though that's a nice-to-have, not required to ship this feature.

### Q4. LLM vendor zero-retention terms — what's the fallback if unavailable?

**Spec location:** §8 ("Confirm a zero-retention/no-training data-processing agreement with the LLM vendor")

**What's missing:** The spec says to confirm this, but doesn't say what happens if the answer is no — is there a fallback vendor/model? Does this block the feature entirely until resolved? Given MST/PTSD/SUD-adjacent content is explicitly named elsewhere in the spec as the highest-sensitivity content type involved, this isn't a minor detail.

**How to resolve:** Whoever picks this up should actually check the current LLM Gateway/provider setup (this app uses Vercel AI Gateway per its existing chat route) and confirm what data-processing terms are actually in place today, before assuming it can just be "confirmed." If it can't be confirmed on the current setup, that's a blocking finding that needs to go back to the founder, not something to route around silently.

### Q5. Is `rag-system`'s ingestion worker + parser sidecar actually running/operational anywhere right now?

**Spec location:** Implicit throughout — the whole feature assumes this pipeline works end-to-end.

**Why this needs verification:** Per this session's own earlier work, `rag-system`'s MCP server wasn't running locally during e2e test verification for the (separate, already-shipped) Knowledge Assistant feature. If the broader ingestion pipeline (worker process that claims `pending_uploads` rows, parser sidecar, embedding pipeline) has never been exercised end-to-end for a real document outside of unit tests, that's a meaningfully different risk profile than "this is proven, working infrastructure we're just pointing at a new use case."

**How to resolve:** Before writing a full implementation plan, run (or ask someone to run) one real document through the existing pipeline manually — upload a test file into a `custom`-kind source via whatever means already exists, confirm it makes it through parsing/classification/chunking/embedding and becomes retrievable. This is the same thing as the walking-skeleton suggestion below (S1), just framed as a verification question rather than a plan step.

---

## Suggestions (non-blocking)

### S1. Add a walking-skeleton task as the literal first implementation step

Before building the full data model, lifecycle, incident-response automation, and audit trail, do the smallest possible end-to-end slice: one workspace, one document, one test user — upload it, confirm it's retrievable, confirm it gets cited in an actual chat response. This directly tests Q1 (OCR) and Q5 (pipeline operability) — the two biggest unverified assumptions — before investing in everything else around them. If this fails, it fails cheaply, before the lifecycle/incident-response/audit machinery (which is a lot of the spec's total surface area) has been built on top of an assumption that turned out wrong.

### S2. Race condition on lazy `ragSourceId` creation

**Spec location:** §2 ("lazily created on first upload")

Two near-simultaneous uploads to the same brand-new (empty) workspace could both observe `ragSourceId: null` and both attempt to create a backing `rag-system` source, resulting in two orphaned/duplicate sources for one workspace. Worth a unique constraint (e.g., a unique index that would reject a second source creation for the same workspace) or an upsert-style guarded creation, not a bare `if (!ragSourceId) { create() }` check with a race window between the check and the write.

### S3. Consider phasing the incident-response automation

**Spec location:** §7

The kill-switch + fully-automated hard-purge-across-every-sink is the right end state, but for an initial, low-user-count launch, a rigorously-followed **manual** purge runbook might be sufficient to ship faster, with automation as a fast-follow. The one part that should **not** be deferred or manual: immediate retrieval exclusion on soft-delete (the actual isolation guarantee) — that must be automated from day one, since it's a live correctness property, not an operational cleanup task. Only worth doing if there's real timeline pressure; not a correctness requirement either way.

### S4. Malicious/oversized file upload handling isn't addressed

Size limits are covered by the monetization caps table (§10), but virus/malware scanning and basic file-type allowlisting aren't mentioned anywhere. This app accepts arbitrary user-supplied files into a pipeline that eventually feeds an LLM prompt — worth at least an explicit one-line stance in the spec (scan or don't, and why), rather than silence implying it wasn't considered.

### S5. Minor wording cleanup once C3 is resolved

Once the singular-vs-plural workspace question (C3) is settled, §2's soft-delete language and §5/§6's retrieval-scope language should be reworded consistently (e.g., "the workspace attached to this conversation" rather than relying on the reader to infer singular-vs-plural from surrounding context).

---

## Resolution Tracking

Update this table as items get resolved. Don't delete rows — mark them resolved with a note on how, so the history of what was found and fixed stays intact.

| ID  | Status | Resolution note |
| --- | ------ | --------------- |
| C1  | Open   |                 |
| C2  | Open   |                 |
| C3  | Open   |                 |
| Q1  | Open   |                 |
| Q2  | Open   |                 |
| Q3  | Open   |                 |
| Q4  | Open   |                 |
| Q5  | Open   |                 |
| S1  | Open   |                 |
| S2  | Open   |                 |
| S3  | Open   |                 |
| S4  | Open   |                 |
| S5  | Open   |                 |

---

## Context for whoever picks this up next

- The spec being reviewed sits at `docs/superpowers/specs/2026-07-14-document-workspace-design.md` in this repo (`veteran-claims-app`).
- That spec is itself the "made buildable" version of a broader product/legal design that lives in a **different repo**: `veteran-disability-ai-resources/docs/superpowers/specs/2026-07-10-veteran-claims-platform-focus-design.md` (the original Phase 1 recommendation, full legal/market/monetization research) and `veteran-disability-ai-resources/docs/superpowers/findings/2026-07-13-product-strategy-synthesis.md` (a follow-up synthesis that refined pricing, GTM, and re-confirmed the legal boundary with sharper, more concrete "safe vs. risky phrasing" examples). **Read both before making any legal-boundary-related decision (especially C1 and C2)** — this findings doc summarizes the relevant parts but isn't a substitute for the full documents.
- A companion classifier spec already exists at `docs/superpowers/specs/2026-07-11-classifier-adaptation-design.md` in this repo — the interim `ClassificationRuleSet` referenced in §4 of the reviewed spec.
- A separate, more sophisticated classification service (`doc-classifier`) has since been built and pushed to its own repo (`github.com/marcusk639/doc-classifier`, also cloned locally at `~/dev/doc-classifier`) but is deliberately not adopted for this phase — see §4's reasoning if reconsidering that choice.
- The next step after this findings document, once Critical Issues are resolved in the spec itself, is to invoke `superpowers:writing-plans` against the updated spec to produce a phased implementation plan — per the spec's own "REQUIRED SUB-SKILL" header note.
