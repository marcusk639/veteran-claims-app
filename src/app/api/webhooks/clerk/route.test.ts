import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";

describe("POST /api/webhooks/clerk", () => {
  beforeEach(() => {
    // svix's Webhook constructor base64-decodes everything after the "whsec_"
    // prefix, so the secret must be valid base64 (this is base64("test_secret_only_for_unit_tests")).
    process.env.CLERK_WEBHOOK_SECRET =
      "whsec_dGVzdF9zZWNyZXRfb25seV9mb3JfdW5pdF90ZXN0cw==";
  });

  it("rejects a request with an invalid signature", async () => {
    const req = new Request("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers: {
        "svix-id": "msg_test",
        "svix-timestamp": `${Math.floor(Date.now() / 1000)}`,
        "svix-signature": "v1,invalidsignature==",
      },
      body: JSON.stringify({ type: "user.created", data: { id: "user_test" } }),
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
  });
});
