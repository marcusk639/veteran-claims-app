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
    execute: async (args): Promise<string> => {
      const client = await getClient();
      const result = await client.callTool({
        name: "get_document",
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
