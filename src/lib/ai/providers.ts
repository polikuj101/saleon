import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AgentConfig, Message } from "../types";
import { buildSystemPrompt } from "./prompt-builder";

function getGrokClient(): OpenAI | null {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key, baseURL: "https://api.x.ai/v1" });
}

async function streamGrok(
  messages: OpenAI.ChatCompletionMessageParam[],
  encoder: TextEncoder
): Promise<ReadableStream<Uint8Array>> {
  const grok = getGrokClient()!;
  const stream = await grok.chat.completions.create({
    model: process.env.GROK_MODEL ?? "grok-3-mini-fast",
    messages,
    max_tokens: 512,
    stream: true,
  });

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

const GEMINI_MODELS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

async function tryGeminiModel(
  genAI: GoogleGenerativeAI,
  modelName: string,
  systemPrompt: string,
  messages: Message[],
  encoder: TextEncoder
): Promise<ReadableStream<Uint8Array>> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "user" ? "user" as const : "model" as const,
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = messages[messages.length - 1].content;
  const result = await chat.sendMessageStream(lastMessage);

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

async function streamGemini(
  systemPrompt: string,
  messages: Message[],
  encoder: TextEncoder
): Promise<ReadableStream<Uint8Array>> {
  const key = process.env.GEMINI_API_KEY!;
  const genAI = new GoogleGenerativeAI(key);
  const models = process.env.GEMINI_MODEL
    ? [process.env.GEMINI_MODEL]
    : GEMINI_MODELS;

  for (let i = 0; i < models.length; i++) {
    try {
      console.log(`[Gemini] Trying ${models[i]}...`);
      return await tryGeminiModel(genAI, models[i], systemPrompt, messages, encoder);
    } catch (err) {
      console.warn(`[Gemini] ${models[i]} failed:`, err);
      if (i === models.length - 1) throw err;
    }
  }
  throw new Error("All Gemini models failed");
}

export async function streamChat(
  messages: Message[],
  agentConfig: AgentConfig
): Promise<ReadableStream<Uint8Array>> {
  const systemPrompt = buildSystemPrompt(agentConfig);
  const encoder = new TextEncoder();

  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const hasGrok = !!process.env.XAI_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  try {
    if (hasGrok) {
      return await streamGrok(openaiMessages, encoder);
    } else if (hasGemini) {
      return await streamGemini(systemPrompt, messages, encoder);
    } else {
      throw new Error("No API key configured (XAI_API_KEY or GEMINI_API_KEY)");
    }
  } catch (err) {
    if (hasGrok && hasGemini) {
      console.warn("[AI] Grok failed, falling back to Gemini:", err);
      return await streamGemini(systemPrompt, messages, encoder);
    }
    throw err;
  }
}
