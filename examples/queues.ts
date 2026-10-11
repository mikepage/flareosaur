/**
 * @title Queues: offload work
 * @difficulty intermediate
 * @tags workers, queues
 * @group Cloudflare
 * @bindings queue:EMAILS, kv:LOG
 * @resource {https://developers.cloudflare.com/queues/} Cloudflare: Queues
 * @resource {https://developers.cloudflare.com/queues/configuration/javascript-apis/} Cloudflare: Queues JavaScript APIs
 * @check POST /signup h:content-type=application/json {"email":"ada@example.com"} -> 202 "queued"
 * @check POST /signup h:content-type=application/json {"name":"bob"} -> 400
 * @check queue EMAILS {"to":"ada@example.com","template":"welcome"}
 * @check queue EMAILS {"nonsense":true}
 * @check GET /sent -> 200 "welcome email to ada@example.com" !"nonsense"
 *
 * Deno Queues let an app hand work to a background listener. On Workers the
 * same thing is a Queue: a producer binding with `send`, and a `queue`
 * handler that gets messages in batches. Each message is acknowledged with
 * `ack()` or handed back with `retry()`; one that keeps failing ends up in
 * the dead letter queue. A message that can never succeed, such as one with
 * the wrong shape, is better acked and logged than retried forever.
 */

interface Env {
  EMAILS: Queue<Email>;
  LOG: KVNamespace;
}

// The message type, shared by producer and consumer. Messages are
// structured-cloned, so plain objects, dates and arrays all work.
interface Email {
  to: string;
  template: "welcome" | "reset";
}

const isEmail = (value: unknown): value is Email =>
  typeof value === "object" && value !== null &&
  typeof (value as Email).to === "string" &&
  ["welcome", "reset"].includes((value as Email).template);

// "Sending" an email appends a line to KV, so the example can show it.
async function sendEmail(env: Env, email: Email): Promise<void> {
  const log = await env.LOG.get("sent") ?? "";
  await env.LOG.put("sent", `${log}${email.template} email to ${email.to}\n`);
}

export default {
  // The producer: queue the email and answer at once.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/signup" && request.method === "POST") {
      const body = await request.json<{ email?: unknown }>().catch(() => ({
        email: undefined,
      }));
      if (typeof body.email !== "string") {
        return new Response("email required", { status: 400 });
      }
      await env.EMAILS.send({ to: body.email, template: "welcome" });
      return new Response("queued", { status: 202 });
    }
    if (url.pathname === "/sent") {
      return new Response(await env.LOG.get("sent") ?? "");
    }
    return new Response("not found", { status: 404 });
  },

  // The consumer. One batch, many messages; handle them one by one so a
  // failure retries only that message.
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (!isEmail(message.body)) {
        console.error("dropping malformed message", message.id, message.body);
        message.ack();
        continue;
      }
      try {
        await sendEmail(env, message.body);
        message.ack();
      } catch (error) {
        // Back off a little longer on every attempt.
        console.warn("retrying", message.id, error);
        message.retry({ delaySeconds: 10 * message.attempts });
      }
    }
  },
} satisfies ExportedHandler<Env, Email>;
