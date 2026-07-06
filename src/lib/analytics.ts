import { PostHog } from "posthog-node";
import { getRequiredEnv } from "@/lib/env";

let client: PostHog | null = null;

function getClient(): PostHog {
  if (!client) {
    client = new PostHog(getRequiredEnv("POSTHOG_API_KEY"), {
      host: "https://us.i.posthog.com",
    });
  }
  return client;
}

export function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  getClient().capture({ distinctId, event, properties });
}
