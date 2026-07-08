import { tool } from "ai";
import { type Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";

// Auto-generated wrapper for MCP tool: trigger_sync
// Source: http://localhost:3001/mcp
export const trigger_syncToolWithClient = (
  getClient: () => Promise<Client> | Client,
) =>
  tool({
    description: `Enqueue a background ingestion job that re-pulls documents from a source, parses them, chunks, embeds, and stores. Returns immediately with the pg-boss job id; sync runs asynchronously in the worker process. This is the correct way to refresh content — never block on sync inside a conversation. Use \`list_sources\` first to discover ids and check when each source was last synced. A scoped session may only sync sources within its allow-list.`,
    inputSchema: z
      .object({
        sourceId: z
          .string()
          .uuid()
          .describe(
            `Id of the source to sync (from list_sources). Each source is dedup-guarded — calling this while a sync for the same source is pending or running returns an error rather than queueing a duplicate.`,
          ),
        mode: z
          .enum(["full", "incremental"])
          .describe(
            `Sync strategy. "incremental" (default) uses the stored cursor and only pulls changes since the last successful sync — fast, cheap, the right default. "full" wipes the cursor and re-enumerates everything in the source — use only when you suspect drift or after schema/config changes.`,
          )
          .optional(),
      })
      .strict(),
    execute: async (args): Promise<string> => {
      const client = await getClient();
      const result = await client.callTool({
        name: "trigger_sync",
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
