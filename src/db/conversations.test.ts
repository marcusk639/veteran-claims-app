import { describe, it, expect } from "vitest";
import { db } from "./index";
import { conversations, messages, type Citation } from "./schema";

describe("conversations/messages schema", () => {
  it("stores a conversation, a message, and structured citations, and reads them back", async () => {
    const [conversation] = await db
      .insert(conversations)
      .values({ userId: "test-user-schema", agentType: "knowledge-assistant" })
      .returning();
    if (!conversation) throw new Error("expected an inserted conversation");

    const citations: Citation[] = [
      {
        source: "38 CFR Part 4 (official)",
        section: "4.130",
        snippet: "Schedule of ratings -- mental disorders.",
      },
    ];

    const [message] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: "assistant",
        content: "Per 38 CFR 4.130, mental disorders are rated...",
        citations,
      })
      .returning();

    expect(message?.citations).toEqual(citations);
    expect(message?.conversationId).toBe(conversation.id);
  });
});
