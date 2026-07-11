# Veteran-Claims Classifier Adaptation — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this design into a phased implementation plan, then superpowers:subagent-driven-development or superpowers:executing-plans to implement it task-by-task.

**Goal:** Define `veteran-claims-app`'s own `ClassificationRuleSet` for the Document Workspace feature, consuming `rag-system`'s new generic classification engine (see `rag-system/docs/superpowers/specs/2026-07-11-generic-document-classification-engine-design.md`) rather than embedding health/PII-specific classification logic inside `rag-system` itself.

**Architecture:** This repo owns and version-controls a `ClassificationRuleSet` object tuned to the sensitivity profile of veteran-uploaded documents (medical records, mental-health/MST/substance-use-adjacent content, decision letters), supplied to the generic engine as external configuration when `rag-system` classifies documents ingested through a workspace's `custom`-kind source. This is a companion, narrower spec to the broader Document Workspace design already committed at `veteran-disability-ai-resources/docs/superpowers/specs/2026-07-10-veteran-claims-platform-focus-design.md` (§6.2) — that spec covers the full feature; this one covers only the rule-set content and this repo's responsibility for owning it.

**Tech Stack:** The `ClassificationRuleSet` TypeScript shape defined in the `rag-system` engine spec; this repo's own deployment configuration for wiring it in.

## Global Constraints

- All constraints from the platform-focus design (`veteran-disability-ai-resources/docs/superpowers/specs/2026-07-10-veteran-claims-platform-focus-design.md`) apply here, in particular: never let this rule set or its wiring live inside `rag-system`'s own repo; strict single-source scoping (`allowedAccessScope: "single-source-only"`) for every tier this rule set can produce, since a veteran's workspace must never be cross-readable.
- The rule set must encode, as data, the sensitivity handling already established by that spec's data-privacy research (§5 of that doc): health-adjacent content (mental health, MST, substance-use) gets the platform's highest-rigor handling tier even though HIPAA itself doesn't apply and 42 CFR Part 2 doesn't legally bind this app — the design commitment to emulate that rigor as good practice is expressed here as an actual rule, not just a paragraph of intent.
- This spec does not re-litigate the workspace data model, incident-response policy, or logging/audit requirements — those are owned by the platform-focus design and unaffected by which classification engine implementation is used underneath.

---

## 1. Problem Statement

The platform-focus design (§6.2) originally proposed a bespoke "veteran-claims implementation" of a `DocumentClassifier` living inside `rag-system`'s own packages — which conflicts with the principle that `rag-system` should contain no product-specific code (see the generic engine spec's problem statement). This spec re-scopes that work: instead of a bespoke implementation inside the platform repo, this repo supplies a data-only `ClassificationRuleSet` to the platform's generic engine.

## 2. Current State

- No classification rule set exists yet for veteran-claims-app — the Document Workspace feature itself is not yet implemented (see the platform-focus design for its full status).
- The sensitivity profile this rule set needs to cover is established by that design's research: mental-health treatment notes, MST-related content, substance-use treatment history, and general medical/decision-letter content, all uploaded voluntarily by the veteran into their own workspace.

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
            /* mental-health, MST, substance-use terminology — exact list is a content-safety task, not invented here */
          ],
        },
        {
          type: "pattern",
          regex:
            "/* SSN, DOB, and other direct-PII patterns, via the generalized scanner */",
          useContentScanner: true,
        },
      ],
      handlingRules: {
        allowedAccessScope: "single-source-only",
        requiresContentScanning: true,
        permittedForIngestion: true, // unlike rag-system's Phase-1-only-A/B default, this app permits its highest tier specifically because single-workspace isolation (enforcedSourceIds) is guaranteed
        retentionRequirements:
          "subject to the incident-response grace-period policy — see the platform-focus design §6.5",
      },
    },
    {
      tier: "B", // general decision letters, non-health-specific claim documents
      matchers: [
        {
          type: "contentType",
          mimeTypes: ["application/pdf", "text/plain" /* etc. */],
        },
      ],
      handlingRules: {
        allowedAccessScope: "single-source-only",
        requiresContentScanning: false,
        permittedForIngestion: true,
      },
    },
  ],
  defaultTier: "D", // fail toward the more conservative tier when content doesn't clearly match a lower-sensitivity rule — this app's documents are never assumed low-sensitivity by default
};
```

The exact keyword/pattern lists are a content-safety task requiring domain review (ideally informed by the same research that produced the corpus's existing MST/mental-health content), not something to invent in this design document — this spec fixes the _shape and defaults_ (fail-conservative, single-source-only for everything, ingestion permitted specifically because of guaranteed isolation), leaving the literal pattern list as an implementation-time task with its own review step.

### 3.2 Ownership and Wiring

This repo owns `veteranClaimsRuleSet` and version-controls it like any other source of truth (e.g., alongside the corpus content in spirit, though this lives in code not `veteran-disability-ai-resources`, since it's operational configuration, not knowledge-base content). It's supplied to the generic engine via whatever mechanism that spec's §3.4 settles on, at the point where this app's workspace ingestion pipeline is wired up (part of the platform-focus design's §6.1/§6.2 implementation).

### 3.3 Relationship to the Platform-Focus Design

This spec narrows and replaces only the "Veteran-claims implementation (new)" bullet in the platform-focus design's §6.2 — everything else in that section (the interface living in `packages/core`, the CPA implementation being a separate concern, the per-classifier ingestion gate, the CPA-regression verification requirement) still applies, now satisfied by the generic engine spec instead of a bespoke in-repo implementation. The platform-focus design should be updated to point here once this is implemented, rather than describing an implementation this spec supersedes.

## 4. Testing & Verification

- Unit tests for `veteranClaimsRuleSet` directly: known mental-health/MST/SUD-adjacent sample content classifies to tier D with `single-source-only` scope; known low-sensitivity content classifies to tier B; ambiguous/unmatched content falls to the conservative default (D), never silently defaults low.
- Integration test (shared with the platform-focus design's §9): the data-isolation test verifying `enforcedSourceIds` scoping holds regardless of which tier a document classified to — this rule set's `permittedForIngestion: true` for tier D depends entirely on that isolation guarantee actually holding.
- No dependency on or interaction with `cpa-consulting`'s migration work — these two rule sets are independent consumers of the same generic engine and can be implemented in either order.

## 5. Open Questions Carried Forward

- The literal keyword/pattern list for tier-D matching needs a content-safety review pass — flagged here as a real task, not filled in with placeholder values.
- Whether this rule set needs a third, intermediate tier (e.g., for records that are health-adjacent but lower-sensitivity, like an appointment confirmation vs. a full treatment note) — start with the two-tier model above and revisit once real uploaded documents are seen in testing, per the platform-focus design's broader feature-bloat guard (don't build tiers speculatively).
