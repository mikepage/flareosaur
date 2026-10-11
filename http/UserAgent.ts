// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Parse `User-Agent` strings into the browser, engine, OS, device and CPU
 * they describe.
 *
 * Effect has no user agent parser. This module runs std's `UserAgent`
 * matchers (a port of ua-parser-js) and returns a {@linkcode UserAgent}
 * Schema class whose fields are `Option`s, so it can be compared, logged and
 * encoded like any other Effect data. {@linkcode UserAgentFromString} is a
 * Schema codec from the header value.
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as UserAgent from "@mikepage/flareosaur/http/user-agent"
 *
 * const ua = UserAgent.parse(
 *   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
 * )
 * ua.browser.name // Option.some("Chrome")
 * ua.os.name // Option.some("macOS")
 *
 * // inside a route handler
 * const handler = Effect.map(UserAgent.fromRequest, (ua) => ua.device.type)
 * ```
 *
 * @module
 */

import { Effect, Option, Result, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { UserAgent as StdUserAgent } from "./_std/user_agent.ts"
import { fromResults, header, type HeadersInput } from "./_internal.ts"

const OptionalString = Schema.Option(Schema.String)

/** The browser described by a user agent. */
export class Browser extends Schema.Class<Browser>("flareosaur/http/UserAgent/Browser")({
  /** The browser name, such as `Chrome`. */
  name: OptionalString,
  /** The full version. */
  version: OptionalString,
  /** The major version. */
  major: OptionalString,
}) {}

/** The device kinds std's matchers recognise. */
export const DeviceType = Schema.Literals(["console", "embedded", "mobile", "tablet", "smarttv", "wearable"])

/** The device described by a user agent. */
export class Device extends Schema.Class<Device>("flareosaur/http/UserAgent/Device")({
  /** The device model. */
  model: OptionalString,
  /** The kind of device; `None` usually means a desktop. */
  type: Schema.Option(DeviceType),
  /** The device vendor. */
  vendor: OptionalString,
}) {}

/** The browser engine described by a user agent. */
export class Engine extends Schema.Class<Engine>("flareosaur/http/UserAgent/Engine")({
  /** The engine name, such as `Blink`. */
  name: OptionalString,
  /** The engine version. */
  version: OptionalString,
}) {}

/** The operating system described by a user agent. */
export class Os extends Schema.Class<Os>("flareosaur/http/UserAgent/Os")({
  /** The OS name. */
  name: OptionalString,
  /** The OS version. */
  version: OptionalString,
}) {}

/** The CPU described by a user agent. */
export class Cpu extends Schema.Class<Cpu>("flareosaur/http/UserAgent/Cpu")({
  /** The CPU architecture, such as `amd64`. */
  architecture: OptionalString,
}) {}

/** A parsed user agent. */
export class UserAgent extends Schema.Class<UserAgent>("flareosaur/http/UserAgent")({
  /** The raw user agent string. */
  ua: Schema.String,
  browser: Browser,
  cpu: Cpu,
  device: Device,
  engine: Engine,
  os: Os,
}) {}

const opt = <A>(a: A | undefined): Option.Option<A> => Option.fromUndefinedOr(a)

/**
 * Parses a user agent string. Never fails: unrecognised parts are `None`,
 * and an absent header parses as the empty string.
 */
export const parse = (ua: string | null | undefined): UserAgent => {
  const std = new StdUserAgent(ua ?? null)
  const { browser, cpu, device, engine, os } = std
  return new UserAgent({
    ua: std.ua,
    browser: new Browser({ name: opt(browser.name), version: opt(browser.version), major: opt(browser.major) }),
    cpu: new Cpu({ architecture: opt(cpu.architecture) }),
    device: new Device({ model: opt(device.model), type: opt(device.type), vendor: opt(device.vendor) }),
    engine: new Engine({ name: opt(engine.name), version: opt(engine.version) }),
    os: new Os({ name: opt(os.name), version: opt(os.version) }),
  })
}

/** A Schema from a `User-Agent` header value to a parsed {@linkcode UserAgent}. */
export const UserAgentFromString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.instanceOf(UserAgent),
    fromResults((s: string) => Result.succeed(parse(s)), (ua: UserAgent) => Result.succeed(ua.ua)),
  ),
)

/** Parses the `User-Agent` header of a message or `Headers`. */
export const get = (input: HeadersInput): UserAgent => parse(Option.getOrNull(header(input, "user-agent")))

/** The parsed user agent of the current `HttpServerRequest`. */
export const fromRequest: Effect.Effect<UserAgent, never, HttpServerRequest.HttpServerRequest> = HttpServerRequest
  .HttpServerRequest.useSync(get)
