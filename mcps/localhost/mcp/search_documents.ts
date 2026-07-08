import { tool } from "ai";
import { type Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";

// Auto-generated wrapper for MCP tool: search_documents
// Source: http://localhost:3001/mcp
export const search_documentsToolWithClient = (
  getClient: () => Promise<Client> | Client,
) =>
  tool({
    description: `Hybrid (dense vector + sparse BM25) retrieval over all ingested documents. Use this when you need the most relevant passages of source material to answer a factual question, ground a response in citations, or locate where a topic is discussed. Returns ranked chunks with document title, heading path, page number when known, source id, url (if any), and a normalized score in [0,1]. The text response is a numbered list; the structured payload contains the full RetrievalResult objects suitable for downstream synthesis or building UI citations. This tool only retrieves passages — call \`ask\` if you also want the model to write a grounded answer for you.`,
    inputSchema: z
      .object({
        query: z.string().min(1).describe("Natural-language search query."),
        topK: z
          .number()
          .int()
          .gt(0)
          .lte(50)
          .describe("Number of chunks to return (default 8, max 50).")
          .optional(),
        sourceIds: z
          .array(z.string().uuid())
          .describe(
            `Restrict the search to specific source ids (from list_sources). Omit to search all sources.`,
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
            `Metadata filter applied to document.metadata. AND across keys, OR across values per key. Example: {"author":"alice","path":["Marketing/2024","Marketing/2025"]}.`,
          )
          .optional(),
      })
      .strict(),
    execute: async (args): Promise<string> => {
      const client = await getClient();
      const result = await client.callTool({
        name: "search_documents",
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
