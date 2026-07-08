import { describe, it, expect, vi } from "vitest";
import { search_documentsToolWithClient } from "./search_documents";

describe("search_documentsToolWithClient", () => {
  it("returns both the flattened text and the structured results array", async () => {
    const structuredResult = {
      text: "PTSD is rated under the General Rating Formula for Mental Disorders.",
      score: 1,
      denseScore: 0.98,
      sparseScore: 0.91,
      document: {
        id: "doc-1",
        title: "Mental Health, PTSD & Mood Disorder Claims",
        sourceId: "source-1",
        sourceKind: "git-markdown",
        metadata: {},
      },
      chunk: {
        id: "chunk-1",
        ordinal: 0,
        headingPath: ["The rating formula (38 CFR 4.130)"],
      },
    };

    const callTool = vi.fn().mockResolvedValue({
      content: ["[1] Mental Health... — score 1.00"],
      structuredContent: { results: [structuredResult] },
    });
    const client = { callTool };

    const tool = search_documentsToolWithClient(() => client as never);
    const output = await tool.execute!({ query: "PTSD rating criteria" }, {
      toolCallId: "call-1",
      messages: [],
    } as unknown as Parameters<NonNullable<typeof tool.execute>>[1]);

    expect(callTool).toHaveBeenCalledWith({
      name: "search_documents",
      arguments: { query: "PTSD rating criteria" },
    });
    expect(output).toEqual({
      text: "[1] Mental Health... — score 1.00",
      results: [structuredResult],
    });
  });

  it("returns an empty results array when structuredContent is missing", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: ["No matching chunks found."],
    });
    const client = { callTool };

    const tool = search_documentsToolWithClient(() => client as never);
    const output = await tool.execute!({ query: "nonexistent topic" }, {
      toolCallId: "call-2",
      messages: [],
    } as unknown as Parameters<NonNullable<typeof tool.execute>>[1]);

    expect(output).toEqual({
      text: "No matching chunks found.",
      results: [],
    });
  });
});
