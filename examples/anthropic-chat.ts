/**
 * @title Call Claude with fetch
 * @difficulty beginner
 * @tags workers, ai
 * @group AI
 * @bindings var:ANTHROPIC_API_KEY=sk-ant-test, outbound:anthropic
 * @resource {https://docs.anthropic.com/en/api/messages} Anthropic: Messages API
 * @resource {https://developers.cloudflare.com/workers/configuration/secrets/} Workers: secrets
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static} MDN: AbortSignal.timeout
 * @check POST /ask h:content-type=application/json {"question":"What is a Durable Object?"} -> 200 "stub reply to: What is a Durable Object?"
 * @check POST /ask h:content-type=application/json {"nope":1} -> 400 "question"
 *
 * The Anthropic Messages API is one HTTPS call, so a Worker needs no SDK:
 * `fetch` with the API key in a header and a JSON body. The key lives in a
 * Worker secret. (The check runs against a stand-in for the API; deploy with
 * a real `ANTHROPIC_API_KEY` secret to talk to Claude.)
 */

interface Env {
  ANTHROPIC_API_KEY: string;
}

// The parts of a Messages API response this example reads.
interface Message {
  content: Array<{ type: string; text?: string }>;
}

async function ask(question: string, env: Env): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: question }],
    }),
    // Don't wait forever on an upstream: give up after a minute.
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `Anthropic API: ${response.status} ${await response.text()}`,
    );
  }
  // The reply is a list of content blocks. Join the text ones.
  const message = await response.json<Message>();
  return message.content.map((block) => block.text ?? "").join("");
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || pathname !== "/ask") {
      return new Response("not found", { status: 404 });
    }

    // Check the input before spending tokens on it.
    const body = await request.json().catch(() => null) as {
      question?: unknown;
    } | null;
    if (typeof body?.question !== "string") {
      return new Response('expected {"question": "..."}', { status: 400 });
    }

    return new Response(await ask(body.question, env));
  },
} satisfies ExportedHandler<Env>;
