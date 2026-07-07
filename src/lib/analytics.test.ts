import { describe, it, expect, vi, beforeEach } from "vitest";

const { captureMock, flushMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  flushMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("posthog-node", () => ({
  PostHog: vi.fn().mockImplementation(function () {
    return {
      capture: captureMock,
      flush: flushMock,
    };
  }),
}));

import { captureServerEvent, flushAnalytics } from "./analytics";

describe("analytics", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "phc_test_only";
    captureMock.mockClear();
    flushMock.mockClear();
  });

  it("captureServerEvent forwards the event to the PostHog client", () => {
    captureServerEvent("user_1", "signup");

    expect(captureMock).toHaveBeenCalledWith({
      distinctId: "user_1",
      event: "signup",
      properties: undefined,
    });
  });

  it("flushAnalytics drains the underlying client's queue via flush(), not shutdown()", async () => {
    await flushAnalytics();

    expect(flushMock).toHaveBeenCalledTimes(1);
  });

  it("flushAnalytics can be called again after captureServerEvent on the same singleton", async () => {
    captureServerEvent("user_2", "signup");
    await flushAnalytics();
    captureServerEvent("user_3", "signup");
    await flushAnalytics();

    expect(captureMock).toHaveBeenCalledTimes(2);
    expect(flushMock).toHaveBeenCalledTimes(2);
  });
});
