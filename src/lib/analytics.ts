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

/**
 * Drains the PostHog client's current event queue.
 *
 * Uses `flush()` rather than `shutdown()` -- `shutdown()` permanently
 * disables the client, which would break reuse of the module-scoped
 * singleton across warm serverless invocations. `flush()` just sends
 * whatever is queued right now and leaves the client usable afterward.
 *
 * Intended to be called from Next.js's `after()` so the serverless
 * function stays alive until the batched event is actually delivered,
 * without adding latency to the response that triggered it.
 */
export async function flushAnalytics(): Promise<void> {
  await getClient().flush();
}
