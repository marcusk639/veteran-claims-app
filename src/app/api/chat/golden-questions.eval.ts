import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { NO_GROUNDING_RESPONSE } from "@/lib/chat-system-prompt";

// Real infrastructure required: RAG_MCP_URL pointing at a running rag-system MCP
// server with the git-markdown and ecfr-part4 sources synced (Task 4), plus a
// configured Gateway provider. Run via `pnpm eval`, not `pnpm test`.

// `auth()` pulls in the `server-only` marker package, which throws outside a
// real Next.js RSC bundler context (no `react-server` resolve condition in
// plain Vitest/Node). Mocked here only so the eval can reach real MCP
// retrieval and `streamText` -- rate limiting, retrieval, and generation stay
// unmocked.
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "eval-user" }),
}));

const CORE_TOPIC_QUESTIONS = [
  "What is a DBQ and why does it matter for my claim?",
  "How does the VA rate PTSD under 38 CFR 4.130?",
  "What's the difference between direct and secondary service connection?",
];

const OUT_OF_SCOPE_QUESTIONS = [
  "What's the weather like in Tokyo today?",
  "Can you help me write a resignation letter for my current job?",
];

async function askAndReadText(question: string): Promise<string> {
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { id: "1", role: "user", parts: [{ type: "text", text: question }] },
        ],
      }),
    }),
  );
  return res.text();
}

describe("Knowledge Assistant golden questions", () => {
  for (const question of CORE_TOPIC_QUESTIONS) {
    it(`grounds and cites a source for: "${question}"`, async () => {
      const text = await askAndReadText(question);
      expect(text.toLowerCase()).not.toContain(
        NO_GROUNDING_RESPONSE.toLowerCase(),
      );
      expect(text).toMatch(/per (this guide|38 CFR)/i);
    });
  }

  for (const question of OUT_OF_SCOPE_QUESTIONS) {
    it(`refuses out-of-scope question: "${question}"`, async () => {
      const text = await askAndReadText(question);
      expect(text).toContain(NO_GROUNDING_RESPONSE);
    });
  }
});
