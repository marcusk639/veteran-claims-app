import { tool } from "ai";
import { type Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";

// Auto-generated wrapper for MCP tool: list_sources
// Source: http://localhost:3001/mcp
export const list_sourcesToolWithClient = (
  getClient: () => Promise<Client> | Client,
) =>
  tool({
    description: `List every registered ingestion source (the systems documents were pulled from: SharePoint sites, Google Drives, mailboxes, etc.). Use this to discover which sources exist and obtain their ids — those ids can be passed to \`search_documents\`/\`ask\` as \`sourceIds\` to restrict the search, or to \`trigger_sync\` to refresh a source. Returns id, kind (sharepoint|gdrive|gmail|outlook|custom), human-friendly name, and the last successful sync timestamp (null if never synced).`,
    inputSchema: z.object({}),
    execute: async (args): Promise<string> => {
      const client = await getClient();
      const result = await client.callTool({
        name: "list_sources",
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
