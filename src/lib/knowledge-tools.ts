import {
  search_documentsTool,
  get_documentTool,
} from "../../mcps/localhost/mcp/index";

/**
 * Only the retrieval tools are exposed to the agent -- never `ask`, per the
 * design spec: veteran-claims-app owns answer synthesis, tone, and citation
 * formatting, not rag-system's own generation.
 */
export function getKnowledgeTools() {
  return {
    searchDocuments: search_documentsTool,
    getDocument: get_documentTool,
  };
}
