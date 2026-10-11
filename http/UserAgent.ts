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

const OptionalString: Schema.Option<Schema.String> = Schema.Option(Schema.String)

const BrowserBase: Schema.Class<
  Browser,
  Schema.Struct<{
    /** The browser name, such as `Chrome`. */
    readonly name: Schema.Option<Schema.String>
    /** The full version. */
    readonly version: Schema.Option<Schema.String>
    /** The major version. */
    readonly major: Schema.Option<Schema.String>
  }>,
  {}
> = Schema.Class<Browser>("flareosaur/http/UserAgent/Browser")({
  /** The browser name, such as `Chrome`. */
  name: OptionalString,
  /** The full version. */
  version: OptionalString,
  /** The major version. */
  major: OptionalString,
})

/** The browser described by a user agent. */
export class Browser extends BrowserBase {}

/** The device kinds std's matchers recognise. */
export const DeviceType: Schema.Literals<
  readonly ["console", "embedded", "mobile", "tablet", "smarttv", "wearable"]
> = Schema.Literals(["console", "embedded", "mobile", "tablet", "smarttv", "wearable"])

const DeviceBase: Schema.Class<
  Device,
  Schema.Struct<{
    /** The device model. */
    readonly model: Schema.Option<Schema.String>
    /** The kind of device; `None` usually means a desktop. */
    readonly type: Schema.Option<typeof DeviceType>
    /** The device vendor. */
    readonly vendor: Schema.Option<Schema.String>
  }>,
  {}
> = Schema.Class<Device>("flareosaur/http/UserAgent/Device")({
  /** The device model. */
  model: OptionalString,
  /** The kind of device; `None` usually means a desktop. */
  type: Schema.Option(DeviceType),
  /** The device vendor. */
  vendor: OptionalString,
})

/** The device described by a user agent. */
export class Device extends DeviceBase {}

const EngineBase: Schema.Class<
  Engine,
  Schema.Struct<{
    /** The engine name, such as `Blink`. */
    readonly name: Schema.Option<Schema.String>
    /** The engine version. */
    readonly version: Schema.Option<Schema.String>
  }>,
  {}
> = Schema.Class<Engine>("flareosaur/http/UserAgent/Engine")({
  /** The engine name, such as `Blink`. */
  name: OptionalString,
  /** The engine version. */
  version: OptionalString,
})

/** The browser engine described by a user agent. */
export class Engine extends EngineBase {}

const OsBase: Schema.Class<
  Os,
  Schema.Struct<{
    /** The OS name. */
    readonly name: Schema.Option<Schema.String>
    /** The OS version. */
    readonly version: Schema.Option<Schema.String>
  }>,
  {}
> = Schema.Class<Os>("flareosaur/http/UserAgent/Os")({
  /** The OS name. */
  name: OptionalString,
  /** The OS version. */
  version: OptionalString,
})

/** The operating system described by a user agent. */
export class Os extends OsBase {}

const CpuBase: Schema.Class<
  Cpu,
  Schema.Struct<{
    /** The CPU architecture, such as `amd64`. */
    readonly architecture: Schema.Option<Schema.String>
  }>,
  {}
> = Schema.Class<Cpu>("flareosaur/http/UserAgent/Cpu")({
  /** The CPU architecture, such as `amd64`. */
  architecture: OptionalString,
})

/** The CPU described by a user agent. */
export class Cpu extends CpuBase {}

const UserAgentBase: Schema.Class<
  UserAgent,
  Schema.Struct<{
    /** The raw user agent string. */
    readonly ua: Schema.String
    readonly browser: typeof Browser
    readonly cpu: typeof Cpu
    readonly device: typeof Device
    readonly engine: typeof Engine
    readonly os: typeof Os
  }>,
  {}
> = Schema.Class<UserAgent>("flareosaur/http/UserAgent")({
  /** The raw user agent string. */
  ua: Schema.String,
  browser: Browser,
  cpu: Cpu,
  device: Device,
  engine: Engine,
  os: Os,
})

/** A parsed user agent. */
export class UserAgent extends UserAgentBase {}

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
export const UserAgentFromString: Schema.decodeTo<Schema.instanceOf<UserAgent>, Schema.String> = Schema.String.pipe(
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
