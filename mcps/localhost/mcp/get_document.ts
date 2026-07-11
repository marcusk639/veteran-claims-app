import { tool } from "ai";
import { type Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";

// Auto-generated wrapper for MCP tool: get_document
// Source: http://localhost:3001/mcp
export const get_documentToolWithClient = (
  getClient: () => Promise<Client> | Client,
) =>
  tool({
    description: `Fetch the full normalized markdown and metadata for a single document by id. Use this after \`search_documents\` when a top-ranked chunk looks promising and you need surrounding context (the chunk is typically just ~800 tokens). The structured payload includes id, title, sourceId, mimeType, sizeBytes, sourceModifiedAt, metadata, and the full markdown body. Returns isError when the id does not exist.`,
    inputSchema: z
      .object({
        documentId: z
          .string()
          .uuid()
          .describe(
            `Document id (UUID) — usually obtained from a search_documents result's \`document.id\` field.`,
          ),
      })
      .strict(),
    // Hand-fix (see search_documents.ts for the same pattern): a thrown
    // connection error is caught and turned into an empty string rather than
    // propagating, so a getDocument failure can't abort the tool-calling
    // loop -- the model still has whatever searchDocuments already returned.
    execute: async (args): Promise<string> => {
      let result;
      try {
        const client = await getClient();
        result = await client.callTool({
          name: "get_document",
          arguments: args,
        });
      } catch {
        return "";
      }

      // A not-found/failed lookup must not reach the model as if it were
      // real document content -- the tool description promises `isError`
      // for a missing id, but the generated wrapper previously ignored it.
      if (result.isError) {
        return "";
      }

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
