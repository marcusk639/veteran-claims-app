import { describe, it, expect, vi } from "vitest";
import { get_documentToolWithClient } from "./get_document";

describe("get_documentToolWithClient", () => {
  it("flattens result.content into a string", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: ["# Title\n\nFull document markdown."],
    });
    const client = { callTool };

    const tool = get_documentToolWithClient(() => client as never);
    const output = await tool.execute!(
      { documentId: "11111111-1111-1111-1111-111111111111" },
      { toolCallId: "call-1", messages: [] } as unknown as Parameters<
        NonNullable<typeof tool.execute>
      >[1],
    );

    expect(output).toBe("# Title\n\nFull document markdown.");
  });

  it("returns an empty string instead of throwing when the MCP call fails (connection failure)", async () => {
    const callTool = vi
      .fn()
      .mockRejectedValue(new Error("connect ECONNREFUSED"));
    const client = { callTool };

    const tool = get_documentToolWithClient(() => client as never);
    const output = await tool.execute!(
      { documentId: "11111111-1111-1111-1111-111111111111" },
      { toolCallId: "call-2", messages: [] } as unknown as Parameters<
        NonNullable<typeof tool.execute>
      >[1],
    );

    expect(output).toBe("");
  });

  it("returns an empty string instead of the error payload when the document id is not found", async () => {
    const callTool = vi.fn().mockResolvedValue({
      isError: true,
      content: ["Document not found: 11111111-1111-1111-1111-111111111111"],
    });
    const client = { callTool };

    const tool = get_documentToolWithClient(() => client as never);
    const output = await tool.execute!(
      { documentId: "11111111-1111-1111-1111-111111111111" },
      { toolCallId: "call-3", messages: [] } as unknown as Parameters<
        NonNullable<typeof tool.execute>
      >[1],
    );

    expect(output).toBe("");
  });
});
