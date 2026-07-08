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
    // Hand-fix to generated code (mcp-to-ai-sdk), matching the client.ts URL/auth
    // hand-edit from Task 6: the generated execute() only ever flattened
    // `result.content` to a string, discarding `result.structuredContent` -- the
    // full RetrievalResult objects the tool's own description promises for
    // building UI citations. Reapply this after any regeneration.
    //
    // Also hand-fixed: a thrown connection error (MCP server down, bad
    // RAG_MCP_URL/RAG_MCP_TOKEN) is caught and turned into the same shape as
    // a zero-result search instead of propagating. streamText would
    // otherwise surface a thrown execute() as a tool-error step and continue
    // the loop, leaving the grounded-refusal guarantee dependent on the
    // model noticing an error -- returning an empty result set instead lets
    // the system prompt's existing "no relevant results" refusal rule apply
    // deterministically to a failed retrieval too.
    execute: async (args) => {
      let result;
      try {
        const client = await getClient();
        result = await client.callTool({
          name: "search_documents",
          arguments: args,
        });
      } catch {
        return { text: "", results: [] };
      }

      // Handle different content types from MCP
      const text = Array.isArray(result.content)
        ? result.content
            .map((item: unknown) =>
              typeof item === "string" ? item : JSON.stringify(item),
            )
            .join("\n")
        : typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content);

      return {
        text,
        results:
          (result.structuredContent as { results?: unknown[] } | undefined)
            ?.results ?? [],
      };
    },
  });
