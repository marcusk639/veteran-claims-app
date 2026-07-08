import { tool } from "ai";
import { type Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";

// Auto-generated wrapper for MCP tool: purge_source
// Source: http://localhost:3001/mcp
export const purge_sourceToolWithClient = (
  getClient: () => Promise<Client> | Client,
) =>
  tool({
    description: `Permanently delete a source and all of its indexed content (documents, chunks, ingestion history, pending uploads). This is irreversible. Use \`list_sources\` first to confirm the correct source id before calling this tool.`,
    inputSchema: z
      .object({
        sourceId: z
          .string()
          .uuid()
          .describe(
            `UUID of the source to permanently delete. All documents, chunks, ingestion history, and pending uploads for this source are removed. This action is irreversible.`,
          ),
      })
      .strict(),
    execute: async (args): Promise<string> => {
      const client = await getClient();
      const result = await client.callTool({
        name: "purge_source",
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
