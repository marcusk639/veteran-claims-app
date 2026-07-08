import { describe, it, expect, vi } from "vitest";

vi.mock("../../mcps/localhost/mcp/index.js", () => ({
  search_documentsTool: { description: "search" },
  get_documentTool: { description: "get" },
  list_sourcesTool: { description: "list" },
  trigger_syncTool: { description: "trigger sync" },
  purge_sourceTool: { description: "purge source" },
  askTool: { description: "ask" },
}));

import { getKnowledgeTools } from "./knowledge-tools";

describe("getKnowledgeTools", () => {
  it("exposes only searchDocuments and getDocument, never ask or listSources", () => {
    const tools = getKnowledgeTools();
    expect(Object.keys(tools).sort()).toEqual([
      "getDocument",
      "searchDocuments",
    ]);
  });
});
