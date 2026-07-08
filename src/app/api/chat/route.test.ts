import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, checkRateLimitMock, streamTextMock, dbInsertMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    streamTextMock: vi.fn(),
    dbInsertMock: vi.fn(),
  }));

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/knowledge-tools", () => ({
  getKnowledgeTools: () => ({ searchDocuments: {}, getDocument: {} }),
}));
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: streamTextMock };
});
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => ({
        returning: async () => [{ id: "conv-1", ...(v as object) }],
      }),
    }),
  },
}));

import { POST } from "./route";

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
});
