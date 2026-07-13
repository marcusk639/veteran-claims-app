"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useState } from "react";
import { CitationPill } from "@/components/citation-pill";
import type { SanitizedRetrievalResult } from "@/lib/retrieval-result-schema";

// The server echoes the conversation id back as message metadata (see
// `messageMetadata` in the route's `toUIMessageStreamResponse` call) so it
// can be threaded into the next request instead of every message starting a
// new, unlinked conversation.
type ChatMessage = UIMessage<{ conversationId?: string }>;

export default function ChatPage() {
  const { messages, sendMessage, status, error, clearError } =
    useChat<ChatMessage>({
      transport: new DefaultChatTransport<ChatMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages: sentMessages, body }) => {
          const conversationId = [...sentMessages]
            .reverse()
            .find((m) => m.metadata?.conversationId)?.metadata?.conversationId;
          return { body: { ...body, conversationId, messages: sentMessages } };
        },
      }),
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
                const results = (
                  part.output as { results?: SanitizedRetrievalResult[] }
                ).results;
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
      {error && (
        <div className="flex items-center gap-2 text-red-600" role="alert">
          <span>
            Something went wrong sending that message. Please try again.
          </span>
          <button type="button" onClick={clearError}>
            Try again
          </button>
        </div>
      )}
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
