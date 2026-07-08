// Auto-generated index file for MCP tools
// Source: http://localhost:3001/mcp
import { getMcpClient } from "./client.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { search_documentsToolWithClient } from "./search_documents.js";
import { get_documentToolWithClient } from "./get_document.js";
import { list_sourcesToolWithClient } from "./list_sources.js";
import { trigger_syncToolWithClient } from "./trigger_sync.js";
import { purge_sourceToolWithClient } from "./purge_source.js";
import { askToolWithClient } from "./ask.js";

// Exports using a default client
export const mcpLocalhostTools = {
  search_documents: search_documentsToolWithClient(getMcpClient),
  get_document: get_documentToolWithClient(getMcpClient),
  list_sources: list_sourcesToolWithClient(getMcpClient),
  trigger_sync: trigger_syncToolWithClient(getMcpClient),
  purge_source: purge_sourceToolWithClient(getMcpClient),
  ask: askToolWithClient(getMcpClient),
} as const;

export const mcpLocalhostToolsWithClient = (client: Promise<Client> | Client) =>
  ({
    search_documents: search_documentsToolWithClient(() => client),
    get_document: get_documentToolWithClient(() => client),
    list_sources: list_sourcesToolWithClient(() => client),
    trigger_sync: trigger_syncToolWithClient(() => client),
    purge_source: purge_sourceToolWithClient(() => client),
    ask: askToolWithClient(() => client),
  }) as const;

// Individual tool exports
export const search_documentsTool =
  search_documentsToolWithClient(getMcpClient);
export const get_documentTool = get_documentToolWithClient(getMcpClient);
export const list_sourcesTool = list_sourcesToolWithClient(getMcpClient);
export const trigger_syncTool = trigger_syncToolWithClient(getMcpClient);
export const purge_sourceTool = purge_sourceToolWithClient(getMcpClient);
export const askTool = askToolWithClient(getMcpClient);
