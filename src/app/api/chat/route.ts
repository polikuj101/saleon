import { streamChat } from "@/lib/ai/providers";
import type { ChatRequest } from "@/lib/types";


export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequest;

    if (!body.messages || !body.agentConfig) {
      return new Response(
        JSON.stringify({ error: "Missing messages or agentConfig" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const stream = await streamChat(body.messages, body.agentConfig);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[chat] Error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
