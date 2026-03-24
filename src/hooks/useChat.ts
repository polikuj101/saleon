"use client";

import { useState, useCallback } from "react";
import type { Message, AgentConfig } from "@/lib/types";

export function useChat(agentConfig: AgentConfig) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg: Message = { role: "user", content: text };
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setIsLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: updatedMessages,
            agentConfig,
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `API error: ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let assistantText = "";

        // Add empty assistant message
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          assistantText += decoder.decode(value, { stream: true });

          // Clean lead scoring tags for display
          const clean = assistantText
            .replace(/\[LEAD:(hot|warm|cold)\]/gi, "")
            .trim();

          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: clean };
            return next;
          });
        }
      } catch (err) {
        console.error("[useChat] Error:", err);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Sorry, something went wrong. Please try again.",
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, agentConfig]
  );

  const reset = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, isLoading, sendMessage, reset };
}
