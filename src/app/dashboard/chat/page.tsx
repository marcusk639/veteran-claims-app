"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { CitationPill } from "@/components/citation-pill";

// Matches the raw MCP RetrievalResult shape returned by search_documents'
// execute() (mcps/localhost/mcp/search_documents.ts) -- the tool output
// streamed to the client is not the flattened Citation shape that
// extractCitations (src/app/api/chat/route.ts) computes server-side for
// persistence, it's this raw shape.
interface SearchResult {
  text: string;
  document: { title: string };
  chunk: { headingPath: string[] };
}

export default function ChatPage() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");

  return (
    <main className="flex flex-col gap-4 p-6">
      <h1>Knowledge Assistant</h1>
      <div className="flex flex-col gap-3" data-testid="chat-messages">
        {messages.map((message) => (
          <div key={message.id}>
            <strong>{message.role}: </strong>
            {message.parts.map((part, i) => {
              if (part.type === "text") {
                return <span key={i}>{part.text}</span>;
              }
              if (
                part.type === "tool-searchDocuments" &&
                part.state === "output-available"
              ) {
                const results = (part.output as { results?: SearchResult[] })
                  .results;
                return (
                  <div key={i} className="mt-1 flex flex-wrap gap-1">
                    {results?.map((r, j) => (
                      <CitationPill
                        key={j}
                        source={r.document.title}
                        section={r.chunk.headingPath.join(" › ")}
                      />
                    ))}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput("");
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={status !== "ready"}
          className="flex-1 border px-2 py-1"
          placeholder="Ask about your VA disability claim..."
        />
        <button type="submit" disabled={status !== "ready"}>
          Send
        </button>
      </form>
    </main>
  );
}
