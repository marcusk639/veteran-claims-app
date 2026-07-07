import { Webhook } from "svix";
import { getRequiredEnv } from "@/lib/env";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics";
import { NextResponse, after } from "next/server";

export async function POST(req: Request) {
  const payload = await req.text();
  const svixHeaders = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  const wh = new Webhook(getRequiredEnv("CLERK_WEBHOOK_SECRET"));
  let event: { type: string; data: { id: string } };
  try {
    event = wh.verify(payload, svixHeaders) as typeof event;
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  if (event.type === "user.created") {
    captureServerEvent(event.data.id, "signup");
    // The serverless sandbox can freeze the instant the response below is
    // sent, before posthog-node's internal batch is flushed over the
    // network. after() keeps the function alive until the flush completes,
    // without delaying this response.
    after(() => flushAnalytics());
  }

  return NextResponse.json({ received: true });
}
