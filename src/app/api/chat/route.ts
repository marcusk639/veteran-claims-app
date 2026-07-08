import { auth } from "@clerk/nextjs/server";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  conversations,
  messages as messagesTable,
  type Citation,
} from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { getKnowledgeTools } from "@/lib/knowledge-tools";
import {
  KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT,
  NO_GROUNDING_RESPONSE,
} from "@/lib/chat-system-prompt";
import { captureServerEvent } from "@/lib/analytics";

const CHAT_RATE_LIMIT = 40; // matches the free-tier "40 msgs/mo" cap's per-minute floor
const CHAT_RATE_WINDOW_SECONDS = 60;

interface ChatRequestBody {
  conversationId?: string;
  messages: UIMessage[];
}

interface McpRetrievalResult {
  text: string;
  document: { title: string };
  chunk: { headingPath: string[] };
}

/**
 * `search_documents`'s vendored wrapper (mcps/localhost/mcp/search_documents.ts)
 * returns `{ text, results }`, where `results` are `SanitizedRetrievalResult`
 * objects straight from rag-system's MCP `structuredContent` (see
 * `@rag/core`'s `RetrievalResult`/`SanitizedRetrievalResult` types).
 */
function extractCitations(toolResults: unknown): Citation[] {
  if (!Array.isArray(toolResults)) return [];
  const citations: Citation[] = [];
  for (const result of toolResults) {
    const output = (result as { output?: unknown })?.output;
    const results = (output as { results?: unknown })?.results;
    if (!Array.isArray(results)) continue;
    for (const item of results as McpRetrievalResult[]) {
      citations.push({
        source: item.document.title,
        section: item.chunk.headingPath.join(" › "),
        snippet: item.text,
      });
    }
  }
  return citations;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(
    `chat:${userId}`,
    CHAT_RATE_LIMIT,
    CHAT_RATE_WINDOW_SECONDS,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  const body = (await req.json()) as ChatRequestBody;

  let conversationId = body.conversationId;
  if (!conversationId) {
    const [created] = await db
      .insert(conversations)
      .values({ userId, agentType: "knowledge-assistant" })
      .returning();
    conversationId = created?.id;
  }

  const lastUserMessage = body.messages[body.messages.length - 1];
  if (lastUserMessage && conversationId) {
    const text = lastUserMessage.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    await db.insert(messagesTable).values({
      conversationId,
      role: "user",
      content: text,
      citations: [],
    });
  }

  let tools: ReturnType<typeof getKnowledgeTools>;
  try {
    tools = getKnowledgeTools();
  } catch {
    // MCP connection failure -- same explicit fallback as a zero-result search,
    // never silently answered from ungrounded model knowledge.
    if (conversationId) {
      await db.insert(messagesTable).values({
        conversationId,
        role: "assistant",
        content: NO_GROUNDING_RESPONSE,
        citations: [],
      });
    }
    return NextResponse.json(
      {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: NO_GROUNDING_RESPONSE }],
      },
      { status: 200 },
    );
  }

  const result = streamText({
    model: "openai/gpt-4.1-mini",
    system: KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(body.messages),
    tools,
    onFinish: async ({ text, toolResults, usage }) => {
      const citations = extractCitations(toolResults);
      if (conversationId) {
        await db.insert(messagesTable).values({
          conversationId,
          role: "assistant",
          content: text,
          citations,
        });
      }
      captureServerEvent(userId, "chat_message", {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      });
    },
  });

  return result.toUIMessageStreamResponse();
}
