import { Webhook } from "svix";
import { getRequiredEnv } from "@/lib/env";
import { captureServerEvent } from "@/lib/analytics";
import { NextResponse } from "next/server";

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
  }

  return NextResponse.json({ received: true });
}
