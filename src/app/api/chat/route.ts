import { auth } from "@clerk/nextjs/server";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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
import { recordMessageCost, checkCostAlert } from "@/lib/cost-alert";

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
  if (conversationId) {
    const [existing] = await db
      .select({ userId: conversations.userId })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
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
    // Default stopWhen is isStepCount(1), which halts right after the tool
    // call step and never lets the model read results and write an answer.
    // Allow: 1) tool call, 2) optional getDocument follow-up, 3) synthesis.
    stopWhen: stepCountIs(3),
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

      // Simple per-token estimate; swap in exact Gateway per-model pricing once
      // real cost data exists (COST_ALERT_THRESHOLD_USD is deliberately left as
      // runtime config, not hardcoded, for the same reason).
      const estimatedCostUsd =
        ((usage?.inputTokens ?? 0) / 1_000_000) * 0.15 +
        ((usage?.outputTokens ?? 0) / 1_000_000) * 0.6;
      try {
        await recordMessageCost(userId, estimatedCostUsd);
        await checkCostAlert(60);
      } catch (error) {
        // Cost tracking is auxiliary -- e.g. COST_ALERT_THRESHOLD_USD/
        // COST_ALERT_WEBHOOK_URL aren't set until real cost data exists
        // (see .env.example). A failure here must never surface to the
        // user, whose chat response has already been generated by now.
        console.error("cost-alert tracking failed", error);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
