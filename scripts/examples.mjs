// Copyright 2026 the flareosaur authors. MIT license.
// Checks the Workers examples in examples/*.ts and generates their index.
//
//   node scripts/examples.mjs [example...]
//
// Every example is a Worker module with a JSDoc header, in the style of
// docs.deno.com/examples:
//
//   @title       Hello world
//   @difficulty  beginner | intermediate | advanced
//   @tags        workers, http
//   @group       Basics
//   @resource    {https://...} Label
//   @bindings    kv:CACHE, d1:DB, r2:BUCKET, queue:JOBS, do:ROOMS=ChatRoom, var:NAME=value,
//                ratelimit:LIMITER=3/60 (a rate limiting binding: 3 requests per 60 s),
//                outbound:echo (outgoing fetches get a JSON echo of the request),
//                outbound:anthropic (a stand-in for the Anthropic Messages API)
//   @check       GET /path [h:Name=Value | h:Name="quoted value"] [body] -> 200 "contains" !"absent" header:name~"value"
//   @check       scheduled [cron]
//   @check       queue JOBS {"json":"body"}
//   @check       ws /path send "message" -> "reply"
//   {{prev:<header>}} in a check is replaced by the last value of that response header
//   @check       none (needs a remote binding, e.g. Workers AI)
//
// Each example is bundled with esbuild, loaded into Miniflare with its
// bindings (no compatibility flags) and its checks run in order. With no
// arguments the index, examples/README.md, is regenerated too.

import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "examples");
const OUT = join(ROOT, "node_modules/.flareosaur-examples");
const COMPAT_DATE = "2026-07-30";

/** Parses the JSDoc header of an example. */
function parseHeader(slug, source) {
  const block = source.match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? "";
  const lines = block.split("\n").map((l) => l.replace(/^\s*\* ?/, ""));
  const tags = new Map();
  const description = [];
  for (const line of lines) {
    const tag = line.match(/^@(\w+)\s*(.*)$/);
    if (tag) tags.set(tag[1], [...(tags.get(tag[1]) ?? []), tag[2].trim()]);
    else description.push(line);
  }
  const one = (name) => tags.get(name)?.[0] ?? "";
  return {
    slug,
    title: one("title") || slug,
    difficulty: one("difficulty") || "beginner",
    group: one("group") || "Other",
    description: description.join("\n").trim(),
    bindings: (tags.get("bindings") ?? []).flatMap((b) =>
      b.split(",").map((s) => s.trim()).filter(Boolean)
    ),
    checks: tags.get("check") ?? [],
  };
}

// A stand-in for the Anthropic Messages API: answers with the last user
// message, so a check can tell it ran.
async function anthropicStub(request) {
  const body = await request.json();
  const last = body.messages.at(-1)?.content;
  const text = typeof last === "string"
    ? last
    : Array.isArray(last)
    ? last.map((p) => p.text ?? "").join("")
    : "";
  return Response.json({
    id: "msg_stub",
    type: "message",
    role: "assistant",
    model: body.model,
    content: [{ type: "text", text: `stub reply to: ${text}` }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });
}

// outbound:echo answers every outgoing fetch with a description of the
// request as JSON, standing in for an upstream API.
async function echo(request) {
  const url = new URL(request.url);
  const body = request.body ? await request.text() : null;
  if (url.pathname.startsWith("/status/")) {
    return new Response(null, { status: Number(url.pathname.slice(8)) });
  }
  if (url.pathname.startsWith("/slow")) {
    await new Promise((r) => setTimeout(r, 2000));
  }
  return Response.json({
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers),
    body,
  });
}

function bindingOptions(example) {
  const options = {
    kvNamespaces: [],
    d1Databases: [],
    r2Buckets: [],
    queueProducers: {},
    queueConsumers: {},
    durableObjects: {},
    bindings: {},
    ratelimits: {},
  };
  for (const binding of example.bindings) {
    const [kind, rest = ""] = binding.split(/:(.*)/s);
    if (kind === "kv") options.kvNamespaces.push(rest);
    else if (kind === "d1") options.d1Databases.push(rest);
    else if (kind === "r2") options.r2Buckets.push(rest);
    else if (kind === "queue") {
      options.queueProducers[rest] = rest.toLowerCase();
      options.queueConsumers[rest.toLowerCase()] = { maxBatchTimeout: 0 };
    } else if (kind === "do") {
      const [name, className] = rest.split("=");
      options.durableObjects[name] = className;
    } else if (kind === "ratelimit") {
      const [name, rule = ""] = rest.split("=");
      const [limit, period] = rule.split("/").map(Number);
      options.ratelimits[name] = { namespace_id: "1001", simple: { limit, period } };
    } else if (kind === "var") {
      const [name, ...value] = rest.split("=");
      options.bindings[name] = value.join("=");
    } else if (kind === "outbound") {
      options.outboundService = async (request) =>
        rest === "anthropic" &&
          new URL(request.url).pathname === "/v1/messages"
          ? anthropicStub(request)
          : echo(request);
    }
  }
  return options;
}

const QUOTED = /"((?:[^"\\]|\\.)*)"/g;
const unquote = (s) => JSON.parse(`"${s}"`);

function parseHttpCheck(check) {
  const [request, expectation = ""] = check.split(/\s->\s/);
  // Tokens are separated by spaces; a header value may be quoted:
  // h:authorization="Basic dXNlcjpwYXNz"
  const tokens = request.trim().match(/h:[^=\s]+="(?:[^"\\]|\\.)*"|\S+/g) ?? [];
  const [method, path, ...rest] = tokens;
  const headers = {};
  const bodyParts = [];
  for (const part of rest) {
    const h = part.match(/^h:([^=]+)=(.*)$/);
    if (h && !bodyParts.length) {
      headers[h[1]] = h[2].startsWith('"') ? unquote(h[2].slice(1, -1)) : h[2];
    } else bodyParts.push(part);
  }
  const contains = [];
  const absent = [];
  const headerContains = [];
  for (const m of expectation.matchAll(/(!|header:([\w-]+)~)?"((?:[^"\\]|\\.)*)"/g)) {
    if (m[1] === "!") absent.push(unquote(m[3]));
    else if (m[2]) headerContains.push([m[2], unquote(m[3])]);
    else contains.push(unquote(m[3]));
  }
  // A quoted body may use JSON escapes such as \n.
  const raw = bodyParts.join(" ");
  const body = !bodyParts.length
    ? undefined
    : raw.startsWith('"') && raw.endsWith('"')
    ? unquote(raw.slice(1, -1))
    : raw;
  return {
    method,
    path,
    headers,
    body,
    status: Number(expectation.trim().match(/^(\d{3})/)?.[1] ?? 200),
    contains,
    absent,
    headerContains,
  };
}

async function runCheck(mf, rawCheck, previousHeaders) {
  const check = rawCheck.replace(
    /\{\{prev:([\w-]+)\}\}/g,
    (_, name) => (previousHeaders.get(name.toLowerCase()) ?? "").replaceAll('"', '\\"'),
  );
  if (check === "none") return;
  if (check.startsWith("scheduled")) {
    const worker = await mf.getWorker();
    const cron = check.slice("scheduled".length).trim() || "* * * * *";
    const result = await worker.scheduled({ cron });
    if (result.outcome !== "ok") throw new Error(`scheduled outcome ${result.outcome}`);
    return;
  }
  if (check.startsWith("queue ")) {
    const [, queue, ...body] = check.split(/\s+/);
    const worker = await mf.getWorker();
    const result = await worker.queue(queue.toLowerCase(), [{
      id: crypto.randomUUID(),
      timestamp: new Date(),
      body: JSON.parse(body.join(" ")),
      attempts: 1,
    }]);
    if (result.outcome !== "ok") throw new Error(`queue outcome ${result.outcome}`);
    return;
  }
  if (check.startsWith("ws ")) {
    const [request, expected = ""] = check.split(/\s->\s/);
    const path = request.split(/\s+/)[1];
    const sends = [...request.matchAll(QUOTED)].map((m) => unquote(m[1]));
    const replies = [...expected.matchAll(QUOTED)].map((m) => unquote(m[1]));
    const res = await mf.dispatchFetch(`http://localhost${path}`, {
      headers: { Upgrade: "websocket" },
    });
    const ws = res.webSocket;
    if (!ws) throw new Error(`no WebSocket upgrade (status ${res.status})`);
    ws.accept();
    const received = [];
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out; received ${JSON.stringify(received)}`)),
        5000,
      );
      ws.addEventListener("message", (event) => {
        received.push(String(event.data));
        if (replies.every((r) => received.some((m) => m.includes(r)))) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    for (const message of sends) ws.send(message);
    await done;
    ws.close();
    return;
  }
  const c = parseHttpCheck(check);
  const res = await mf.dispatchFetch(`http://localhost${c.path}`, {
    method: c.method,
    headers: c.headers,
    ...(c.body === undefined ? {} : { body: c.body }),
    redirect: "manual",
  });
  const text = await res.text();
  res.headers.forEach((value, name) => previousHeaders.set(name.toLowerCase(), value));
  const problems = [];
  if (res.status !== c.status) problems.push(`status ${res.status}, expected ${c.status}`);
  for (const s of c.contains) {
    if (!text.includes(s)) problems.push(`body lacks ${JSON.stringify(s)}`);
  }
  for (const s of c.absent) {
    if (text.includes(s)) problems.push(`body contains ${JSON.stringify(s)}`);
  }
  for (const [name, s] of c.headerContains) {
    const value = res.headers.get(name);
    if (!(value ?? "").includes(s)) {
      problems.push(`header ${name}=${JSON.stringify(value)} lacks ${JSON.stringify(s)}`);
    }
  }
  if (problems.length) {
    throw new Error(`${problems.join("; ")}\n--- body ---\n${text.slice(0, 1500)}`);
  }
}

/** Lists the examples, sorted by group and title. */
function loadExamples() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_") && !f.endsWith(".d.ts"))
    .map((f) => parseHeader(f.slice(0, -3), readFileSync(join(DIR, f), "utf8")))
    .sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
}

// Resolves the published specifiers (@mikepage/flareosaur/...) to this repo.
function selfResolver(name, exports) {
  return {
    name: "self",
    setup(b) {
      b.onResolve({ filter: new RegExp(`^${name.replace("/", "\\/")}(/|$)`) }, (args) => {
        const file = exports[`.${args.path.slice(name.length)}`];
        return file
          ? { path: join(ROOT, file.slice(2)) }
          : { errors: [{ text: `No export ${args.path}` }] };
      });
    },
  };
}

async function runExample(example) {
  const config = JSON.parse(readFileSync(join(ROOT, "deno.json"), "utf8"));
  const out = join(OUT, example.slug);
  rmSync(out, { recursive: true, force: true });
  await build({
    entryPoints: [join(DIR, `${example.slug}.ts`)],
    outdir: out,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "esnext",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["module", "main"],
    loader: { ".wasm": "copy" },
    external: ["cloudflare:*"],
    plugins: [selfResolver(config.name, config.exports)],
    logLevel: "silent",
  });
  const main = `${example.slug}.js`;
  const modules = readdirSync(out)
    .map((name) => ({
      type: name.endsWith(".wasm") ? "CompiledWasm" : "ESModule",
      path: join(out, name),
      contents: readFileSync(join(out, name)),
    }))
    .sort((a, b) => a.path.endsWith(main) ? -1 : b.path.endsWith(main) ? 1 : 0);
  const mf = new Miniflare({
    modules,
    modulesRoot: out,
    compatibilityDate: COMPAT_DATE,
    compatibilityFlags: [],
    ...bindingOptions(example),
  });
  try {
    const previousHeaders = new Map();
    for (const check of example.checks) {
      try {
        await runCheck(mf, check, previousHeaders);
      } catch (e) {
        throw new Error(`${check}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await mf.dispose().catch(() => {});
  }
}

/** Group order in the index; groups not listed come last, alphabetically. */
const GROUP_ORDER = [
  "Basics",
  "HTTP",
  "Cloudflare",
  "Data formats",
  "Standard library",
  "Cryptography",
  "AI",
];
const LEVELS = ["beginner", "intermediate", "advanced"];

/** Generates examples/README.md: every example by group, easiest first. */
function writeIndex(examples) {
  const rank = (group) => GROUP_ORDER.indexOf(group) + 1 || GROUP_ORDER.length + 1;
  const groups = Map.groupBy(examples, (e) => e.group);
  const ordered = [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  const lines = [
    "# flareosaur examples",
    "",
    "The [Deno examples](https://docs.deno.com/examples/), rewritten as plain Cloudflare Workers.",
    "Each file is a Worker with a commented walkthrough, built on web APIs, the",
    "Workers bindings and flareosaur's std where it helps. No `nodejs_compat`, no",
    "other dependencies.",
    "",
    "Run one with `npx wrangler dev examples/<name>.ts`. `npm run examples` checks them all in workerd.",
    "",
  ];
  for (const [group, list] of ordered) {
    lines.push(`## ${group}`, "");
    const sorted = [...list].sort((a, b) =>
      LEVELS.indexOf(a.difficulty) - LEVELS.indexOf(b.difficulty) ||
      a.title.localeCompare(b.title)
    );
    for (const e of sorted) {
      const level = e.difficulty === "beginner" ? "" : ` · ${e.difficulty}`;
      lines.push(`- [${e.title}](${e.slug}.ts)${level}`);
    }
    lines.push("");
  }
  const todo = join(DIR, "TODO.md");
  try {
    lines.push(readFileSync(todo, "utf8").trim(), "");
  } catch {
    // No examples left to port.
  }
  writeFileSync(join(DIR, "README.md"), lines.join("\n"));
}

const slugs = process.argv.slice(2);
const all = loadExamples();
if (!slugs.length) writeIndex(all);
const examples = all.filter((e) => !slugs.length || slugs.includes(e.slug));
let failed = 0;
for (const example of examples) {
  try {
    await runExample(example);
    const manual = example.checks.every((c) => c === "none");
    console.log(`${manual ? "skip" : "ok  "} ${example.slug}${manual ? " (no local checks)" : ""}`);
  } catch (e) {
    failed++;
    const message = e instanceof Error ? e.message : String(e);
    console.log(`FAIL ${example.slug}\n     ${message.split("\n").join("\n     ")}`);
  }
}
console.log(`\n${examples.length - failed} of ${examples.length} examples passed`);
process.exit(failed ? 1 : 0);
