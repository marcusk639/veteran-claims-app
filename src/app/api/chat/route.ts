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

/**
 * The vendored MCP tool wrappers (src/lib/knowledge-tools.ts) serialize the
 * MCP response's `content` array to a single string in `output` -- they
 * don't surface `structuredContent`. So citations only come through when
 * that string happens to be (or contain) JSON shaped like
 * `{ results: [{ source, section, snippet }] }`; anything else yields no
 * citations for that tool result rather than throwing.
 */
function extractCitations(toolResults: unknown): Citation[] {
  if (!Array.isArray(toolResults)) return [];
  const citations: Citation[] = [];
  for (const result of toolResults) {
    const output = (result as { output?: unknown })?.output;
    if (typeof output !== "string") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      continue;
    }
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { results?: unknown })?.results)
        ? (parsed as { results: unknown[] }).results
        : [];
    for (const item of items) {
      const r = item as { source?: string; section?: string; snippet?: string };
      if (r.source && r.snippet) {
        citations.push({
          source: r.source,
          section: r.section ?? "",
          snippet: r.snippet,
        });
      }
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
