// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Cloudflare Workers runtime primitives as Effect services: the Worker
 * entry point, KV, R2, Queues, Cron Triggers, the Cache API and Durable
 * Objects. They play the part of `Deno.serve`, Deno KV, `Deno.cron` and
 * Deno Queues in the Deno examples.
 *
 * @module
 */

export * as Cache from "./Cache.ts"
export * as DurableObject from "./DurableObject.ts"
export * as Kv from "./Kv.ts"
export * as Queue from "./Queue.ts"
export * as R2 from "./R2.ts"
export * as Scheduled from "./Scheduled.ts"
export * as Worker from "./Worker.ts"
