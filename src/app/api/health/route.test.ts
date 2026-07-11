import { describe, it, expect, vi } from "vitest";

describe("GET /api/health", () => {
  it("returns 200 ok when the database is reachable", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 503 error when the database is unreachable, without leaking error details", async () => {
    vi.resetModules();
    vi.doMock("@/db", () => ({
      db: {
        execute: () => Promise.reject(new Error("connection refused")),
      },
    }));

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });

    vi.doUnmock("@/db");
    vi.resetModules();
  });
});
