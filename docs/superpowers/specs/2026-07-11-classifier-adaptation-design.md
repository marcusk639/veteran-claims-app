# Interim Document Classifier — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this design into a phased implementation plan, then superpowers:subagent-driven-development or superpowers:executing-plans to implement it task-by-task.

**Goal:** Implement a simple, rule-based `DocumentClassifier` for the Document Workspace feature (see `veteran-disability-ai-resources/docs/superpowers/specs/2026-07-10-veteran-claims-platform-focus-design.md` §6.2) using `rag-system`'s new minimal interface — good enough to ship the Document Workspace MVP now, deliberately not blocked on the more sophisticated future classification engine.

**Architecture:** This repo owns a rule-based `ClassificationRuleSet` (keyword/pattern/content-type matchers, fail-conservative defaults) satisfying `rag-system`'s `DocumentClassifier` interface (`rag-system/docs/superpowers/specs/2026-07-11-generic-document-classification-engine-design.md`). It is explicitly an interim implementation: if/when the future RAG+LLM-based classification service (`rag-system/docs/superpowers/specs/2026-07-11-future-generic-classification-service-vision.md`) is ever built, this rule-based classifier is swapped out for one backed by that service — the Document Workspace's calling code doesn't change, only which implementation is wired in.

**Tech Stack:** The `ClassificationRuleSet`/`DocumentClassifier` shapes defined in `rag-system`'s minimal-interface spec; this repo's own deployment configuration.

## Global Constraints

- All constraints from the platform-focus design apply here — in particular, `allowedAccessScope: "single-source-only"` on every tier this rule set can produce, since a veteran's workspace must never be cross-readable.
- Fail-conservative: unmatched or ambiguous content defaults to the highest-sensitivity tier, never a low-sensitivity default.
- This is explicitly interim. Do not over-invest here — a good keyword/pattern rule set that correctly fails conservative is sufficient for MVP; semantic nuance (recognizing paraphrased sensitive content without exact keyword matches) is a known limitation, accepted for now, and the reason the future-vision spec exists.
- This work is not blocked on, and does not block, the future classification service — proceed independently.

---

## 1. Problem Statement

The Document Workspace feature needs _some_ working classifier to ship — the platform-focus design's original §6.2 proposed a bespoke in-`rag-system` implementation (superseded) and later design conversation explored a much more sophisticated RAG+LLM+eval engine (deferred, see the future-vision spec). This spec covers the middle ground: a simple, good-enough, interim implementation that unblocks the MVP now.

## 2. Current State

- No classifier exists yet — the Document Workspace feature itself is not yet implemented.
- `rag-system` now has (or will have, per its companion spec) a minimal `DocumentClassifier` interface and per-classifier ingestion gate, ready for this repo to implement against.

## 3. Design

### 3.1 `ClassificationRuleSet` Content

```ts
const veteranClaimsRuleSet: ClassificationRuleSet = {
  productId: "veteran-claims-app",
  rules: [
    {
      tier: "D", // highest-rigor tier this app uses
      matchers: [
        {
          type: "keyword",
          values: [
            /* mental-health, MST, substance-use terminology — a content-safety task, not invented here */
          ],
        },
        {
          type: "pattern",
          regex: "/* SSN, DOB, and other direct-PII patterns */",
        },
      ],
      handlingRules: {
        allowedAccessScope: "single-source-only",
        requiresContentScanning: true,
        permittedForIngestion: true, // permitted specifically because single-workspace isolation (enforcedSourceIds) is guaranteed
        retentionRequirements:
          "subject to the incident-response grace-period policy — platform-focus design §6.5",
      },
    },
    {
      tier: "B", // general decision letters, non-health-specific claim documents
      matchers: [
        { type: "contentType", mimeTypes: ["application/pdf", "text/plain"] },
      ],
      handlingRules: {
        allowedAccessScope: "single-source-only",
        requiresContentScanning: false,
        permittedForIngestion: true,
      },
    },
  ],
  defaultTier: "D", // fail conservative — this app's documents are never assumed low-sensitivity by default
};
```

The literal keyword/pattern list is a content-safety review task, not something to invent in this document — this spec fixes the shape and the fail-conservative defaults.

### 3.2 Ownership and Wiring

This repo owns `veteranClaimsRuleSet`, supplied to `rag-system`'s ingestion gate at the point the Document Workspace's ingestion pipeline is wired up.

### 3.3 Upgrade Path (informational, not scoped here)

If the future classification service is ever built, this rule set is replaced by an implementation backed by that service, using the _same corpus already ingested for the chat feature_ (`veteran-disability-ai-resources`) as its classification knowledge base — meaning this app would face zero cold-start/bootstrapping cost if that future work is picked up, per the future-vision spec's §2.4. This is worth knowing but is not a reason to wait for it now.

## 4. Testing & Verification

- Unit tests for `veteranClaimsRuleSet`: known mental-health/MST/SUD-adjacent sample content classifies to tier D with `single-source-only` scope; known low-sensitivity content classifies to tier B; ambiguous/unmatched content falls to the conservative default (D).
- Integration test (shared with the platform-focus design's §9): the data-isolation test verifying `enforcedSourceIds` scoping holds for every tier this classifier can produce.

## 5. Open Questions Carried Forward

- The literal keyword/pattern list needs a content-safety review pass before implementation.
- Whether a third, intermediate tier is needed — start with two tiers, revisit only if real uploaded documents in testing show a clear need, per the platform-focus design's feature-bloat guard.
