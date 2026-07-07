import { describe, it, expect, vi, beforeEach } from "vitest";

// This file exercises the after()-scheduled analytics flush in isolation
// from the real svix signature verification (covered separately in
// route.test.ts). Mocking `svix` and `next/server`'s `after` lets us
// observe that after() is actually invoked with a flushing callback --
// something that isn't observable via a real Next.js request lifecycle
// under plain Vitest.

const { afterMock, captureServerEventMock, flushAnalyticsMock, verifyMock } =
  vi.hoisted(() => ({
    afterMock: vi.fn(),
    captureServerEventMock: vi.fn(),
    flushAnalyticsMock: vi.fn().mockResolvedValue(undefined),
    verifyMock: vi.fn((payload: string) => JSON.parse(payload)),
  }));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: afterMock,
  };
});

vi.mock("svix", () => ({
  Webhook: vi.fn().mockImplementation(function () {
    return { verify: verifyMock };
  }),
}));

vi.mock("@/lib/analytics", () => ({
  captureServerEvent: captureServerEventMock,
  flushAnalytics: flushAnalyticsMock,
}));

import { POST } from "./route";

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "svix-id": "msg_test",
      "svix-timestamp": `${Math.floor(Date.now() / 1000)}`,
      "svix-signature": "v1,test==",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/clerk - after() flush scheduling", () => {
  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET =
      "whsec_dGVzdF9zZWNyZXRfb25seV9mb3JfdW5pdF90ZXN0cw==";
    afterMock.mockClear();
    captureServerEventMock.mockClear();
    flushAnalyticsMock.mockClear();
    verifyMock.mockClear();
  });

  it("schedules a flush via after() when a signup event is captured", async () => {
    const req = buildRequest({
      type: "user.created",
      data: { id: "user_test" },
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(captureServerEventMock).toHaveBeenCalledWith("user_test", "signup");
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(afterMock).toHaveBeenCalledWith(expect.any(Function));

    // Invoke the scheduled callback and confirm it flushes analytics.
    const scheduledCallback = afterMock.mock.calls[0][0] as () => Promise<void>;
    expect(flushAnalyticsMock).not.toHaveBeenCalled();
    await scheduledCallback();
    expect(flushAnalyticsMock).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a flush for events other than user.created", async () => {
    const req = buildRequest({
      type: "user.updated",
      data: { id: "user_test" },
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(captureServerEventMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });
});
