import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  authMock,
  checkRateLimitMock,
  streamTextMock,
  dbInsertMock,
  captureServerEventMock,
  getKnowledgeToolsMock,
  recordMessageCostMock,
  checkCostAlertMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  streamTextMock: vi.fn(),
  dbInsertMock: vi.fn(),
  captureServerEventMock: vi.fn(),
  getKnowledgeToolsMock: vi.fn(),
  recordMessageCostMock: vi.fn(),
  checkCostAlertMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/knowledge-tools", () => ({
  getKnowledgeTools: getKnowledgeToolsMock,
}));
vi.mock("@/lib/analytics", () => ({
  captureServerEvent: captureServerEventMock,
}));
vi.mock("@/lib/cost-alert", () => ({
  recordMessageCost: recordMessageCostMock,
  checkCostAlert: checkCostAlertMock,
}));
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: streamTextMock };
});
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        dbInsertMock(v);
        return {
          returning: async () => [{ id: "conv-1", ...(v as object) }],
        };
      },
    }),
  },
}));

import { POST } from "./route";
import { NO_GROUNDING_RESPONSE } from "@/lib/chat-system-prompt";

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue({ userId: "user_test" });
    checkRateLimitMock
      .mockReset()
      .mockResolvedValue({ allowed: true, remaining: 39 });
    streamTextMock.mockReset().mockReturnValue({
      toUIMessageStreamResponse: () => new Response("ok", { status: 200 }),
    });
    dbInsertMock.mockReset();
    captureServerEventMock.mockReset();
    recordMessageCostMock.mockReset();
    checkCostAlertMock.mockReset().mockResolvedValue({
      totalUsd: 0,
      alert: false,
    });
    getKnowledgeToolsMock
      .mockReset()
      .mockReturnValue({ searchDocuments: {}, getDocument: {} });
  });

  it("returns 401 when there is no authenticated user", async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await POST(buildRequest({ messages: [] }));
    expect(res.status).toBe(401);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await POST(buildRequest({ messages: [] }));
    expect(res.status).toBe(429);
  });

  it("calls streamText with the knowledge tools and system prompt when allowed", async () => {
    const res = await POST(
      buildRequest({
        messages: [
          { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const call = streamTextMock.mock.calls[0][0];
    expect(call.tools).toEqual({ searchDocuments: {}, getDocument: {} });
    expect(call.system).toContain("Knowledge Assistant");
  });

  it("builds citations from the search_documents wrapper's structured results on finish", async () => {
    await POST(
      buildRequest({
        messages: [
          {
            id: "1",
            role: "user",
            parts: [{ type: "text", text: "What is a DBQ?" }],
          },
        ],
      }),
    );

    const { onFinish } = streamTextMock.mock.calls[0][0];
    await onFinish({
      text: "A DBQ is a Disability Benefits Questionnaire.",
      usage: { inputTokens: 10, outputTokens: 5 },
      toolResults: [
        {
          output: {
            text: "[1] DBQ Overview — score 0.95\n   A DBQ is a form used to document disability claims.",
            results: [
              {
                text: "A DBQ is a form used to document disability claims.",
                score: 0.95,
                denseScore: 0.94,
                sparseScore: 0.88,
                document: {
                  id: "doc-1",
                  title: "DBQ Overview",
                  sourceId: "source-1",
                  sourceKind: "git-markdown",
                  metadata: {},
                },
                chunk: {
                  id: "chunk-1",
                  ordinal: 0,
                  headingPath: ["What is a DBQ", "Overview"],
                },
              },
            ],
          },
        },
      ],
    });

    const assistantInsert = dbInsertMock.mock.calls
      .map(([v]) => v as { role?: string; citations?: unknown })
      .find((v) => v.role === "assistant");
    expect(assistantInsert?.citations).toEqual([
      {
        source: "DBQ Overview",
        section: "What is a DBQ › Overview",
        snippet: "A DBQ is a form used to document disability claims.",
      },
    ]);
  });

  it("returns the grounded-refusal response and skips streamText when the MCP connection fails", async () => {
    getKnowledgeToolsMock.mockImplementationOnce(() => {
      throw new Error("MCP connection refused");
    });

    const res = await POST(
      buildRequest({
        messages: [
          { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parts).toEqual([{ type: "text", text: NO_GROUNDING_RESPONSE }]);

    const assistantInsert = dbInsertMock.mock.calls
      .map(
        ([v]) => v as { role?: string; content?: string; citations?: unknown },
      )
      .find((v) => v.role === "assistant");
    expect(assistantInsert?.content).toBe(NO_GROUNDING_RESPONSE);
    expect(assistantInsert?.citations).toEqual([]);

    expect(streamTextMock).not.toHaveBeenCalled();
  });
});
