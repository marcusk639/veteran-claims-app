import { tool } from "ai";
import { type Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";

// Auto-generated wrapper for MCP tool: ask
// Source: http://localhost:3001/mcp
export const askToolWithClient = (getClient: () => Promise<Client> | Client) =>
  tool({
    description: `Retrieve relevant passages from the indexed corpus and generate a cited answer using the configured generation model. Use this when the user wants a written answer rather than raw search results. The model is prompted to ground every claim in numbered [N] citations and to admit ignorance when context is insufficient — it should not hallucinate. The text response contains the answer with a Sources footer; the structured payload contains the raw answer, citation list (index, documentId, title, url, chunkId, score), and retrievedCount. Returns isError when no generation provider is configured on the server (set GENERATION_PROVIDER and GENERATION_MODEL); use \`search_documents\` instead in that case.`,
    inputSchema: z
      .object({
        question: z
          .string()
          .min(1)
          .describe("The natural-language question to answer."),
        topK: z
          .number()
          .int()
          .gt(0)
          .lte(50)
          .describe(
            `How many chunks to retrieve as context for the generator (default 8, max 50). Larger values give the model more context but slow generation and may dilute relevance.`,
          )
          .optional(),
        sourceIds: z
          .array(z.string().uuid())
          .describe(
            `Restrict retrieval to specific source ids (from list_sources). Omit to search all sources.`,
          )
          .optional(),
        filter: z
          .record(
            z.string(),
            z.union([
              z.string().max(256),
              z.array(z.string().max(256)).max(50),
            ]),
          )
          .describe(
            `Metadata filter applied to document.metadata. AND across keys, OR across values per key.`,
          )
          .optional(),
      })
      .strict(),
    execute: async (args): Promise<string> => {
      const client = await getClient();
      const result = await client.callTool({
        name: "ask",
        arguments: args,
      });

      // Handle different content types from MCP
      if (Array.isArray(result.content)) {
        return result.content
          .map((item: unknown) =>
            typeof item === "string" ? item : JSON.stringify(item),
          )
          .join("\n");
      } else if (typeof result.content === "string") {
        return result.content;
      } else {
        return JSON.stringify(result.content);
      }
    },
  });
