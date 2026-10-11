/**
 * @title IPv6 utils
 * @difficulty intermediate
 * @tags workers, http, schema, network
 * @group Network
 * @resource {https://www.rfc-editor.org/rfc/rfc5952} RFC 5952: IPv6 text representation
 * @resource {https://effect.website/docs/schema/introduction/} Effect: Schema
 * @resource {https://tools.mikepage.nl/ipv6-utils} Original tool: tools.mikepage.nl/ipv6-utils
 * @check GET / -> 200 "ipv6_utils" "/api?address="
 * @check GET /api?address=2001:db8::1&prefix=64&cidr=2001:db8::/32 -> 200 "\"fullAddress\":\"2001:0db8:0000:0000:0000:0000:0000:0001\"" "\"compressedAddress\":\"2001:db8::1\"" "\"inRange\":true"
 * @check GET /api?address=2001:db9::1&cidr=2001:db8::/32 -> 200 "\"inRange\":false"
 * @check GET /api?address=2001:db8::1&cidr=2001:db8:: -> 200 "\"compressedAddress\":\"2001:db8::1\"" "\"prefixLength\":64" "\"cidrError\":\"Use CIDR notation: address/prefix\"" !"inRange"
 * @check GET /api?address=2001:db8::1&prefix=48 -> 200 "\"networkAddress\":\"2001:db8::\"" "\"prefixLength\":48"
 * @check GET /api?address=2001:db8:1:2:3:4:5:6 -> 200 "\"networkAddress\":\"2001:db8:1:2::\"" "\"lastAddress\":\"2001:db8:1:2:ffff:ffff:ffff:ffff\"" "\"totalAddresses\":\"2^64\""
 * @check GET /api?address=2001:db8::1&prefix=120 -> 200 "\"lastAddress\":\"2001:db8::ff\"" "\"totalAddresses\":\"256\""
 * @check GET /api?address=2001:0db8:0000:0001:0000:0000:0000:0001 -> 200 "\"compressedAddress\":\"2001:db8:0:1::1\""
 * @check GET /api?address=:: -> 200 "\"fullAddress\":\"0000:0000:0000:0000:0000:0000:0000:0000\"" "\"compressedAddress\":\"::\""
 * @check GET /api?address=1::2::3 -> 400 "invalid IPv6 address"
 * @check GET /api?address=192.168.0.1 -> 400 "invalid IPv6 address"
 * @check GET /api?address=1:2:3:4:5:6:7:8:: -> 400 "invalid IPv6 address"
 * @check GET /api?address=2001:db8::1&prefix=129 -> 400 "prefix must be an integer 0-128"
 * @check GET /api -> 400 "error"
 * @check GET /api?use=mine h:cf-connecting-ip=2a01:4f8::7 -> 200 "\"networkAddress\":\"2a01:4f8::\""
 * @check GET /api?use=mine h:cf-connecting-ip=192.0.2.1 -> 400 "No IPv6 address found"
 *
 * Expands and compresses IPv6 addresses, works out the network, first and
 * last address and size for a prefix length, and checks whether an address
 * is inside a CIDR range. The math is pure 128-bit `BigInt` code using
 * `Option` and `Result`; the query string is decoded with a Schema, and
 * `use=mine` reads the caller's address from `CF-Connecting-IP`.
 */

import { Effect, Layer, Option, Result, Schema, SchemaIssue } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// --- Pure helpers -----------------------------------------------------------

// Eight zero-padded lowercase groups, or None when the input is not IPv6.
const expandIpv6 = (input: string): Option.Option<string> => {
  const parts = input.trim().split("::")
  if (parts.length > 2) return Option.none()
  let groups: Array<string>
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(":") : []
    const right = parts[1] ? parts[1].split(":") : []
    const missing = 8 - left.length - right.length
    if (missing < 1) return Option.none()
    groups = [...left, ...Array<string>(missing).fill("0"), ...right]
  } else {
    groups = parts[0]!.split(":")
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return Option.none()
  return Option.some(groups.map((g) => g.padStart(4, "0").toLowerCase()).join(":"))
}

// RFC 5952: strip leading zeros and collapse the longest run (two or more)
// of zero groups to "::".
const compressIpv6 = (full: string): string => {
  const groups = full.split(":").map((g) => g.replace(/^0+/, "") || "0")
  let best = -1
  let bestLen = 0
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== "0") {
      i++
      continue
    }
    let j = i
    while (j < groups.length && groups[j] === "0") j++
    if (j - i > bestLen) [best, bestLen] = [i, j - i]
    i = j
  }
  if (bestLen < 2) return groups.join(":")
  return `${groups.slice(0, best).join(":")}::${groups.slice(best + bestLen).join(":")}`
}

const toBigInt = (full: string): bigint => full.split(":").reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n)

const fromBigInt = (value: bigint): string => {
  const groups: Array<string> = []
  for (let i = 0; i < 8; i++, value >>= 16n) groups.unshift((value & 0xffffn).toString(16).padStart(4, "0"))
  return groups.join(":")
}

const networkOf = (full: string, prefix: number): bigint =>
  toBigInt(full) & (((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix))

interface Ipv6Details {
  readonly fullAddress: string
  readonly compressedAddress: string
  readonly networkAddress: string
  readonly prefixLength: number
  readonly firstAddress: string
  readonly lastAddress: string
  readonly totalAddresses: string
}

// The address and its enclosing network. Takes an already expanded address,
// so it cannot fail.
const describeIpv6 = (full: string, prefix: number): Ipv6Details => {
  const hostBits = 128 - prefix
  const network = networkOf(full, prefix)
  const total = 1n << BigInt(hostBits)
  return {
    fullAddress: full,
    compressedAddress: compressIpv6(full),
    networkAddress: compressIpv6(fromBigInt(network)),
    prefixLength: prefix,
    firstAddress: compressIpv6(fromBigInt(network)),
    lastAddress: compressIpv6(fromBigInt(network | (total - 1n))),
    totalAddresses: total > 1_000_000n ? `2^${hostBits}` : total.toString(),
  }
}

// Is `full` inside `cidr` (e.g. 2001:db8::/32)? A bad range is a Failure
// with a message, not an exception.
const inCidr = (full: string, cidr: string): Result.Result<boolean, string> => {
  const [range = "", prefixText] = cidr.trim().split("/")
  if (!prefixText) return Result.fail("Use CIDR notation: address/prefix")
  const prefix = Number(prefixText)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return Result.fail("Prefix length must be between 0 and 128")
  return Option.match(expandIpv6(range), {
    onNone: () => Result.fail("Invalid IPv6 range address"),
    onSome: (r) => Result.succeed(networkOf(full, prefix) === networkOf(r, prefix)),
  })
}

// --- Input ------------------------------------------------------------------

// The query string, decoded in one step. Each check carries the message the
// original tool returned, so the JSON errors stay the same.
const Ipv6String = Schema.String.check(
  Schema.makeFilter((s: string) => Option.isSome(expandIpv6(s)), { message: "invalid IPv6 address" }),
)
const Prefix = Schema.FiniteFromString.check(
  Schema.makeFilter((n: number) => Number.isInteger(n) && n >= 0 && n <= 128, { message: "prefix must be an integer 0-128" }),
)
const Query = Schema.Struct({
  address: Schema.OptionFromOptional(Ipv6String),
  prefix: Prefix.pipe(Schema.withDecodingDefaultKey(Effect.succeed("64"))),
  cidr: Schema.OptionFromOptional(Schema.String),
  // use=mine takes the address the request came from.
  use: Schema.OptionFromOptional(Schema.Literal("mine")),
})

// A request that decodes but still cannot be answered.
class InputError extends Schema.TaggedError<InputError>()("InputError", { message: Schema.String }) {}

// "<param>: <message>" for each problem in the query string.
const standard = SchemaIssue.makeFormatterStandardSchemaV1()
const formatIssue = (issue: SchemaIssue.Issue): string =>
  standard(issue).issues
    .map((i) => {
      const path = (i.path ?? []).map((p) => String(typeof p === "object" ? p.key : p)).join(".")
      return path ? `${path}: ${i.message}` : i.message
    })
    .join("; ")
const badRequest = (message: string) => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: message }, { status: 400 }))

// --- Routes -----------------------------------------------------------------

const describeTool = HttpServerResponse.jsonUnsafe({
  name: "ipv6_utils",
  description:
    "Expand and compress an IPv6 address, compute its network, first/last address and size for a prefix length, and optionally check whether it falls inside a CIDR range.",
  params: {
    address: "IPv6 address, e.g. 2001:db8::1 (required unless use=mine)",
    prefix: "Prefix length 0-128 (default 64)",
    cidr: "Optional CIDR range to check against, e.g. 2001:db8::/32",
    use: "\"mine\" to use the IPv6 address this request came from",
  },
  example: "/api?address=2001:db8::1&prefix=64&cidr=2001:db8::/32",
})

const api = Effect.gen(function*() {
  const query = yield* HttpServerRequest.schemaSearchParams(Query)
  const request = yield* HttpServerRequest.HttpServerRequest

  // Pick the address: the caller's own (must be IPv6) or the one asked for.
  const address = yield* Option.match(query.use, {
    onSome: () => {
      const client = Option.fromNullishOr(request.headers["cf-connecting-ip"])
      return Option.match(Option.flatMap(client, expandIpv6), {
        onSome: Effect.succeed,
        onNone: () =>
          Effect.fail(
            new InputError({
              message: Option.match(client, {
                onSome: (ip) => `No IPv6 address found: you are connecting over IPv4 (${ip}).`,
                onNone: () => "No IPv6 address found.",
              }),
            }),
          ),
      })
    },
    onNone: () =>
      Option.match(Option.flatMap(query.address, expandIpv6), {
        onSome: Effect.succeed,
        onNone: () => Effect.fail(new InputError({ message: "address is required" })),
      }),
  })

  const details = describeIpv6(address, query.prefix)
  // An empty cidr= is the same as none. A bad range keeps the address
  // details and reports why the range check could not run.
  const cidr = Option.filter(Option.map(query.cidr, (c) => c.trim()), (c) => c.length > 0)
  const result = Option.match(cidr, {
    onNone: () => details,
    onSome: (c) =>
      Result.match(inCidr(address, c), {
        onSuccess: (inRange) => ({ ...details, cidr: c, inRange }),
        onFailure: (cidrError) => ({ ...details, cidr: c, cidrError }),
      }),
  })
  return HttpServerResponse.jsonUnsafe(result)
}).pipe(
  Effect.catchTags({
    SchemaError: (error) => badRequest(formatIssue(error.issue)),
    InputError: (error) => badRequest(error.message),
  }),
)

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", describeTool),
  HttpRouter.add("GET", "/api", api),
)

export default Worker.make({ fetch: routes })
