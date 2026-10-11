/**
 * @title Durable Objects: a counter
 * @difficulty intermediate
 * @tags workers, durable-objects
 * @group Cloudflare
 * @bindings do:COUNTERS=Counter
 * @resource {https://developers.cloudflare.com/durable-objects/} Cloudflare: Durable Objects
 * @resource {https://developers.cloudflare.com/durable-objects/api/storage-api/} Cloudflare: Durable Object Storage
 * @check POST /counters/likes -> 200 "likes: 1"
 * @check POST /counters/likes -> 200 "likes: 2"
 * @check POST /counters/views -> 200 "views: 1"
 * @check GET /counters/likes -> 200 "likes: 2"
 * @check DELETE /counters/likes -> 200 "likes: 0"
 *
 * A Durable Object is a single instance with its own storage: every request
 * for the same name reaches the same object, one at a time, so a counter
 * never loses an update. The class extends `DurableObject`, keeps its state
 * in `ctx.storage`, and exposes plain methods. The Worker calls them on a
 * stub over RPC, as if the object were local.
 */

import { DurableObject } from "cloudflare:workers";

interface Env {
  COUNTERS: DurableObjectNamespace<Counter>;
}

// The runtime creates one instance per name, somewhere in the world, and
// keeps it while it is in use.
export class Counter extends DurableObject<Env> {
  // ctx.storage is transactional and private to this object. Within one
  // method nothing else runs in between, so read, add and write is safe.
  async increment(): Promise<number> {
    const count = (await this.ctx.storage.get<number>("count") ?? 0) + 1;
    await this.ctx.storage.put("count", count);
    return count;
  }

  async get(): Promise<number> {
    return await this.ctx.storage.get<number>("count") ?? 0;
  }

  async reset(): Promise<number> {
    // deleteAll removes everything the object stored.
    await this.ctx.storage.deleteAll();
    return 0;
  }
}

const route = new URLPattern({ pathname: "/counters/:name" });

export default {
  async fetch(request, env) {
    const name = route.exec(request.url)?.pathname.groups.name;
    if (!name) return new Response("not found", { status: 404 });

    // getByName turns a name into the stub of that object. The same name
    // always reaches the same object.
    const counter = env.COUNTERS.getByName(name);

    let count: number;
    switch (request.method) {
      case "POST":
        count = await counter.increment();
        break;
      case "GET":
        count = await counter.get();
        break;
      case "DELETE":
        count = await counter.reset();
        break;
      default:
        return new Response("method not allowed", { status: 405 });
    }
    return new Response(`${name}: ${count}`);
  },
} satisfies ExportedHandler<Env>;
