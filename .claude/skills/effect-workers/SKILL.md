---
name: effect-workers
description: Rules for Effect (effect@4) code that runs on Cloudflare Workers - what may outlive a request, what may be cached per isolate, how to build the router, keep startup CPU down, and where an MCP or RPC server belongs. Use when writing or reviewing Effect code in a Worker's fetch, scheduled or queue handler, when adding a layer, a forked fiber, a cache or a background loop, when using McpServer or RpcServer over HTTP, when a deploy fails with 10021 (startup CPU), or when requests on one isolate hang and show as `canceled` with ~1 ms CPU.
---

# Effect on Cloudflare Workers

Effect assumes a process that stays alive (Node, Bun). A Worker only does
work while a request is open, and everything a request creates belongs to
it: its timers, its promises, its I/O. When the request ends or is
cancelled, its timers never fire and its promises can't be settled by
anyone else. Effect code that is fine in Node can hang a Worker's isolate.

This skill covers only what is specific to Effect. For general Workers
practice (`ctx.waitUntil`, floating promises, bindings, config), load
Cloudflare's `workers-best-practices` skill as well.

## The failure to recognise

Every request on one isolate hangs, while `/health` and static assets on the
same isolate still answer. In production the requests end as `canceled`
after the client gives up, with ~1 ms CPU. Locally workerd answers 500, "The
Workers runtime canceled this request because it detected that your
Worker's code had hung". It lasts until the isolate is recycled (a deploy).

The cause is always the same: something one request started, another
request waits on.

## Lifetime: nothing outlives its request

- No fiber that outlives a request behind the fetch handler: no
  `Effect.runFork`, `Effect.forkDaemon` or `Effect.forkScoped` in a layer or
  at module level, no queue consumer, `Stream.tick`, `Effect.repeat` /
  `Schedule` loop or `PubSub` subscriber that serves later requests.
- Why: a fiber's dispatcher (`MixedSchedulerDispatcher` in `Scheduler.ts`)
  queues its next turn behind one `setImmediate`/`setTimeout(0)` and
  schedules no other until that one fires. If the request that set it ends
  first, the timer is gone and the fiber never runs again. Repro:
  https://github.com/mikepage/effect-mcp-workers-repro, Effect-TS/effect#9025.
- Fork inside the request's own fiber and join or interrupt before the
  response, or `Effect.forkScoped` in a scope that closes with the request.
- Work after the response: `ctx.waitUntil(Effect.runPromise(...))`.
  Background or scheduled work: a Queue consumer, a Cron trigger, a Workflow,
  or a Durable Object, which is the only place a long-lived fiber may live.
- A request that must stay open without I/O (an SSE stream) needs a pending
  timer, or workerd treats it as hung: merge a keep-alive `Stream.tick`, as
  `McpServer` does.

## Per-isolate state: settled values only

- Never keep a pending promise, `Deferred`, `Effect.cached` /
  `Effect.cachedWithTTL` result or lazy value at module level that one
  request starts and others await. If the first request is cancelled, the
  rest wait forever.
- Keep the settled value with its fetch time. A request that finds it
  missing or stale fetches it itself, with its own timeout. Concurrent
  requests may each fetch; that is the price and it is cheap.
- Watch libraries that do this internally. jose's `createRemoteJWKSet` kept
  per isolate shares one pending key fetch; replace it with a cached
  `createLocalJWKSet` and your own refetch.
- Bindings (`env.DB`, KV, R2, service bindings) and I/O objects come from
  the request, provided per request (`Context` / `Effect.provideService`),
  never captured in a layer that is built once.

## Building the app

- Build the router once at module load, `HttpRouter.toWebHandler(layer)`
  in global scope, not in the first request. Effect falls back to microtasks
  for the timers Workers disallow in global scope, and a build with no I/O
  completes there, so no request owns it.
- When the build needs the request's `env` or does I/O, never share a build
  in progress (`routerPromise ??= build(env)`, a lazily built
  `ManagedRuntime`). Let each request that finds nothing built build its
  own, and keep the first that has finished and answered. flareosaur's
  `Worker.make` does this.
- The layer passed to `toWebHandler` is shared by every request on the
  isolate. Services in it hold configuration and functions, not request
  state or pending work.
- Per-request services go in through the handler's context or `middleware`,
  so each request builds its own.

## Startup CPU

A Worker gets 1 s of CPU for its global scope; over that the deploy fails
with 10021 ("Script startup exceeded CPU time limit"), and near the limit it
fails on some deploys and not others.

- Each module-level `Effect.fn("name")` captures its definition stack with
  `new Error()`, which is expensive in workerd: ~800 of them cost ~200 ms.
  Use `Effect.fnUntraced` where a span adds nothing (the documented way).
- Or set `Error.stackTraceLimit = 0` in a module every entry imports first,
  and restore it once the router is built; Effect then skips the capture.
  This relies on an Effect internal, so keep a test that it still works.
- Don't build what an isolate rarely uses (an MCP server, a second API): give
  it its own Worker.
- Measure with `wrangler check startup` before and after, and gate CI on a
  budget well under 1 s (e.g. 500 ms locally).

## MCP and RPC servers

`McpServer.layerHttp` (and `RpcServer` over HTTP) runs one long-lived server
fiber and hands it each POST through an inbox; the request only waits for
the reply. That is the wrong shape in a Worker's fetch handler: the loop is
driven by whichever request comes along and hangs as above. A warm-up
request hides it but doesn't fix it. Instead:

- build the server per request: only the stateless revision
  (`McpProtocol.v2026_07_28`, no session kept in an isolate's memory), with
  `HttpRouter.toWebHandler(Server)` acquired at the start of the request and
  its `dispose` released at the end, so its fiber lives and dies inside that
  request. Buffer the answer. Example:
  https://github.com/mikepage/flareosaur/blob/main/examples/mcp-server.ts
- put the server in a Durable Object, which outlives requests; needed for
  server-to-client features (sampling, elicitation) and subscriptions, or
- skip MCP and expose the `HttpApi` as a CLI (`HttpApi.reflect` gives every
  endpoint as a command, with the API's auth).

Effect-TS/effect#9026 asks for a request-scoped mode of `layerHttp`.

## Safety net: the sync scheduler

`new Scheduler.MixedScheduler("sync")` runs a fiber's next turn in a
microtask instead of a timer, so no request takes it along when it ends.
Provide it to the app's layer:

```ts
const SyncSchedulerLive = Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))
const app = HttpRouter.toWebHandler(AppLive.pipe(Layer.provideMerge(SyncSchedulerLive)))
```

- It stops the scheduler hang: in the repro every scenario passes, and a busy
  fiber runs about 13x faster (workerd's `setTimeout(0)` per yield is slow).
- A CPU-heavy fiber no longer lets other requests on the isolate run between
  its turns.
- `Effect.sleep`, timeouts and schedules still use real timers, which still
  die with their request: a long-lived fiber that sleeps hangs anyway.

It is a safety net, not a reason to keep fibers alive. The rules above stay.

## Hangs must be visible

- Give each request a time limit (`Effect.timeout` on the handler) that
  answers 503 and logs what it waited on, so a stall shows as an error
  instead of a silent `canceled`.
- Test the cancelled-first case: start a request, abort it before it
  answers, then check that the next request on the same isolate answers.
  In `wrangler dev` each run gets a fresh isolate; in vitest, make the first
  call's promise never settle and assert the second one resolves.

## Review checklist

Search changed Effect code for these and check each against the rules above:

```sh
rg -n 'runFork|forkDaemon|forkScoped|Effect\.cached|cachedWithTTL|Layer\.memoize|Queue\.|PubSub\.|Stream\.tick|Effect\.repeat|McpServer|RpcServer|createRemoteJWKSet' src
rg -n '^(let|const) \w+\s*(:[^=]+)?=\s*(new Promise|.*\.then\()' src
rg -n '\?\?=\s*(await\s+)?\(?\w+\(' src   # a lazily started build or fetch kept per isolate
```
