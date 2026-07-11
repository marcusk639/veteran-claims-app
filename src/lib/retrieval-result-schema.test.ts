import { describe, it, expect } from "vitest";
import { sanitizedRetrievalResultSchema } from "./retrieval-result-schema";

const validResult = {
  text: "A DBQ is a Disability Benefits Questionnaire.",
  score: 0.95,
  denseScore: 0.94,
  sparseScore: 0.88,
  document: {
    id: "doc-1",
    title: "DBQ Overview",
    sourceId: "source-1",
    sourceKind: "git-markdown",
    metadata: { title: "DBQ Overview", path: "guides/dbq.md" },
  },
  chunk: {
    id: "chunk-1",
    ordinal: 0,
    headingPath: ["What is a DBQ", "Overview"],
  },
};

describe("sanitizedRetrievalResultSchema", () => {
  it("parses a valid SanitizedRetrievalResult", () => {
    const result = sanitizedRetrievalResultSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it("rejects a result missing a required field", () => {
    const withoutScore: Record<string, unknown> = { ...validResult };
    delete withoutScore.score;
    const result = sanitizedRetrievalResultSchema.safeParse(withoutScore);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown sourceKind", () => {
    const result = sanitizedRetrievalResultSchema.safeParse({
      ...validResult,
      document: { ...validResult.document, sourceKind: "not-a-real-kind" },
    });
    expect(result.success).toBe(false);
  });

  it("strips unrecognized fields instead of rejecting, so upstream additions don't break parsing", () => {
    const result = sanitizedRetrievalResultSchema.safeParse({
      ...validResult,
      unexpectedNewField: "from a future rag-system version",
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("unexpectedNewField");
  });

  it("accepts document/chunk optional fields when present and omits them when absent", () => {
    const withOptionals = sanitizedRetrievalResultSchema.safeParse({
      ...validResult,
      document: {
        ...validResult.document,
        url: "https://example.com/dbq",
        hasOriginal: true,
      },
      chunk: { ...validResult.chunk, page: 3 },
    });
    expect(withOptionals.success).toBe(true);

    const withoutOptionals =
      sanitizedRetrievalResultSchema.safeParse(validResult);
    expect(withoutOptionals.success).toBe(true);
  });
});
