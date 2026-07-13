import { auth } from "@clerk/nextjs/server";
import { streamText, stepCountIs, type ModelMessage } from "ai";
import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  conversations,
  messages as messagesTable,
  type Citation,
} from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { incrementUsage } from "@/lib/usage";
import { isFoundingSupporter } from "@/lib/founding-supporter";
import { getKnowledgeTools } from "@/lib/knowledge-tools";
import { KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT } from "@/lib/chat-system-prompt";
import { captureServerEvent } from "@/lib/analytics";
import { recordMessageCost, checkCostAlert } from "@/lib/cost-alert";
import { sanitizedRetrievalResultSchema } from "@/lib/retrieval-result-schema";

const CHAT_RATE_LIMIT = 40; // matches the free-tier "40 msgs/mo" cap's per-minute floor
const CHAT_RATE_WINDOW_SECONDS = 60;
const CHAT_MONTHLY_LIMIT = 40;
const CHAT_USAGE_FEATURE = "knowledge_assistant_messages";
const CHAT_MODEL_STANDARD = "openai/gpt-4.1-mini";
// Founding Supporter tier (see docs/superpowers/findings/2026-07-13-product-strategy-synthesis.md
// §3): unlimited messages + priority model, no Document Workspace dependency.
const CHAT_MODEL_PRIORITY = "openai/gpt-4.1";

const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.enum(["user", "assistant", "system"]),
        parts: z.array(z.object({ type: z.string() }).passthrough()),
      }),
    )
    .min(1),
});

/**
 * `search_documents`'s vendored wrapper (mcps/localhost/mcp/search_documents.ts)
 * returns `{ text, results }`, where `results` are `SanitizedRetrievalResult`
 * objects straight from rag-system's MCP `structuredContent` (see
 * `@rag/core`'s `RetrievalResult`/`SanitizedRetrievalResult` types). That's an
 * untrusted cross-service boundary, so each item is parsed defensively --
 * a malformed/renamed field drops that one citation instead of throwing and
 * losing the whole persisted reply.
 */
function extractCitations(toolResults: unknown): Citation[] {
  if (!Array.isArray(toolResults)) return [];
  const citations: Citation[] = [];
  for (const result of toolResults) {
    const output = (result as { output?: unknown })?.output;
    const results = (output as { results?: unknown })?.results;
    if (!Array.isArray(results)) continue;
    for (const raw of results) {
      const parsed = sanitizedRetrievalResultSchema.safeParse(raw);
      if (!parsed.success) continue;
      citations.push({
        source: parsed.data.document.title,
        section: parsed.data.chunk.headingPath.join(" › "),
        snippet: parsed.data.text,
      });
    }
  }
  return citations;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    console.warn("chat: unauthenticated request rejected");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(
    `chat:${userId}`,
    CHAT_RATE_LIMIT,
    CHAT_RATE_WINDOW_SECONDS,
  );
  if (!rateLimit.allowed) {
    console.warn("chat: per-minute rate limit exceeded", { userId });
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  const parseResult = chatRequestSchema.safeParse(await req.json());
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "invalid request body" },
      { status: 400 },
    );
  }
  const body = parseResult.data;

  // Founding Supporter tier: unlimited monthly messages + priority model.
  // The per-minute limiter above still applies to everyone -- it's an
  // abuse-scale burst floor, not a monetization gate. Checked after body
  // validation so a malformed request that will 400 anyway doesn't pay for
  // the DB round-trip.
  const isSupporter = await isFoundingSupporter(userId);

  const lastMessage = body.messages[body.messages.length - 1];
  if (lastMessage.role !== "user") {
    return NextResponse.json(
      { error: "the last message must be from the user" },
      { status: 400 },
    );
  }

  // Ownership is a read-only check with no side effects, so it runs before
  // the (side-effecting) monthly cap check below -- a forbidden/IDOR-probe
  // request never sent a real chat message and must not consume quota.
  let conversationId = body.conversationId;
  if (conversationId) {
    const [existing] = await db
      .select({ userId: conversations.userId })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!existing || existing.userId !== userId) {
      // Prioritize this one: a mismatch (as opposed to "doesn't exist") is
      // the IDOR-probe signal -- someone supplied a real conversationId they
      // don't own.
      console.warn("chat: forbidden conversation access attempt", {
        userId,
        conversationId,
      });
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // The per-minute limiter above only floors abuse-scale bursts; this is the
  // actual free-tier "40 msgs/mo" cap, tracked per calendar month. Must run
  // before any conversation/message rows are written below -- otherwise an
  // over-limit user still gets a brand-new orphaned conversation (if no
  // conversationId was supplied) and/or a persisted question with no
  // assistant reply.
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  );
  const monthlyCount = await incrementUsage(
    userId,
    CHAT_USAGE_FEATURE,
    monthStart,
  );
  if (!isSupporter && monthlyCount > CHAT_MONTHLY_LIMIT) {
    console.warn("chat: monthly message cap exceeded", {
      userId,
      monthlyCount,
    });
    return NextResponse.json(
      { error: "monthly message limit reached" },
      { status: 429 },
    );
  }

  if (!conversationId) {
    const [created] = await db
      .insert(conversations)
      .values({ userId, agentType: "knowledge-assistant" })
      .returning();
    conversationId = created?.id;
  }

  const text = lastMessage.parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("\n");

  if (conversationId) {
    await db.insert(messagesTable).values({
      conversationId,
      role: "user",
      content: text,
      citations: [],
    });
  }

  // The model's context is reconstructed from persisted history rather than
  // the client-echoed `messages` array (beyond the new user turn extracted
  // above) -- this is the conversation's actual source of truth, and it means
  // a client can't forge fabricated assistant/system turns into the model's
  // context by tampering with the request body.
  const priorMessages = conversationId
    ? await db
        .select({ role: messagesTable.role, content: messagesTable.content })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conversationId))
        .orderBy(messagesTable.createdAt)
    : [];
  const modelMessages: ModelMessage[] = priorMessages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const tools = getKnowledgeTools();

  const result = streamText({
    model: isSupporter ? CHAT_MODEL_PRIORITY : CHAT_MODEL_STANDARD,
    system: KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    // Default stopWhen is isStepCount(1), which halts right after the tool
    // call step and never lets the model read results and write an answer.
    // Allow: 1) tool call, 2) optional getDocument follow-up, 3) synthesis.
    stopWhen: stepCountIs(3),
    abortSignal: req.signal,
    onFinish: async ({ text: answerText, toolResults, usage }) => {
      const citations = extractCitations(toolResults);

      // Persistence, analytics, and cost tracking are all tail work with no
      // bearing on the response already streamed to the client -- deferred to
      // `after()` so none of it is silently dropped if the serverless
      // function freezes right after the stream's last chunk is flushed (the
      // same class of bug already fixed once in the Clerk webhook route).
      after(async () => {
        if (conversationId) {
          await db.insert(messagesTable).values({
            conversationId,
            role: "assistant",
            content: answerText,
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
      });
    },
  });

  return result.toUIMessageStreamResponse({
    // Echoes the conversation id back to the client so it can be threaded
    // into the next request's body (see ChatMessage/prepareSendMessagesRequest
    // in src/app/dashboard/chat/page.tsx) instead of every message starting a
    // new, unlinked conversation.
    messageMetadata: () => (conversationId ? { conversationId } : undefined),
  });
}
