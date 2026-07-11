import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getRequiredEnv } from "@/lib/env";

let connectionPromise: Promise<Client> | null = null;
export async function getMcpClient(): Promise<Client> {
  if (connectionPromise) {
    return connectionPromise;
  }

  // Don't cache a rejected connection attempt -- otherwise a single transient
  // MCP outage (bad RAG_MCP_URL/token, server down at first call) poisons this
  // warm serverless instance permanently, since every later call would await
  // the same cached rejection until the platform recycles the instance.
  connectionPromise = connectToMcp().catch((error) => {
    connectionPromise = null;
    throw error;
  });
  return connectionPromise;
}

async function connectToMcp(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(getRequiredEnv("RAG_MCP_URL")),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${getRequiredEnv("RAG_MCP_TOKEN")}`,
        },
      },
    },
  );
  const client = new Client(
    {
      name: "ai-sdk-mcp-wrapper",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );
  await client.connect(transport);
  return client;
}

// Optional: Add cleanup function for graceful shutdown
export async function closeMcpClient(): Promise<void> {
  if (connectionPromise) {
    const client = await connectionPromise;
    await client.close();
    connectionPromise = null;
  }
}
