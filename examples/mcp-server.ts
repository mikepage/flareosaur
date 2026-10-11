/**
 * @title Build an MCP server
 * @difficulty intermediate
 * @tags workers, ai, mcp
 * @group AI
 * @resource {https://modelcontextprotocol.io} Model Context Protocol
 * @resource {https://github.com/Effect-TS/effect/blob/main/packages/effect/MCP.md} Effect: MCP server
 * @check POST /mcp h:content-type=application/json h:accept="application/json, text/event-stream" h:mcp-protocol-version=2026-07-28 h:mcp-method=tools/list {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"check","version":"1"}}}} -> 200 "convert_temperature"
 * @check POST /mcp h:content-type=application/json h:accept="application/json, text/event-stream" h:mcp-protocol-version=2026-07-28 h:mcp-method=tools/call h:mcp-name=convert_temperature {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"convert_temperature","arguments":{"celsius":100},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"check","version":"1"}}}} -> 200 "212"
 *
 * The Model Context Protocol is how AI assistants call tools you host. A
 * Worker is a good place for an MCP server: public, fast, cheap. Effect's
 * `McpServer` serves tools defined with Schemas over MCP's HTTP transport,
 * as routes on an `HttpRouter`. Parameters are decoded and results encoded by
 * the Schemas, so a model gets typed errors instead of crashes.
 *
 * Two things make it safe on Workers:
 *
 * - The stateless protocol revision (2026-07-28): no session to keep, so it
 *   doesn't matter which isolate a call lands on. The older revisions keep
 *   their session in the isolate's memory.
 * - A server per request. `McpServer` runs a long-lived fiber that serves
 *   every request handed to it. A Worker's timers and promises belong to the
 *   request that made them, so a fiber that outlives its request can stop
 *   for good and hang every later call (Effect-TS/effect#9025). Building the
 *   server for each request and closing it after keeps that fiber inside one
 *   request. For server-to-client features (sampling, elicitation) put the
 *   server in a Durable Object instead.
 */

import { Effect, Layer, Schema } from "effect"
import * as HttpRouter from "effect/http/HttpRouter"
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// A tool: name, description, parameters and result, all as Schemas.
const ConvertTemperature = Tool.make("convert_temperature", {
  description: "Convert a temperature from Celsius to Fahrenheit",
  parameters: Schema.Struct({ celsius: Schema.Number }),
  success: Schema.Struct({ fahrenheit: Schema.Number }),
})

const Tools = Toolkit.make(ConvertTemperature)

// The implementations, as Effects.
const ToolHandlers = Tools.toLayer({
  convert_temperature: ({ celsius }) => Effect.succeed({ fahrenheit: celsius * 9 / 5 + 32 }),
})

// A resource the assistant can read.
const Units = McpServer.resource({
  uri: "doc://units",
  name: "Units",
  mimeType: "text/plain",
  content: Effect.succeed("Temperatures are in degrees Celsius unless stated otherwise."),
})

const Server = Layer.mergeAll(McpServer.toolkit(Tools).pipe(Layer.provideMerge(ToolHandlers)), Units).pipe(
  Layer.provide(McpServer.layerHttp({
    name: "flareosaur examples",
    version: "1.0.0",
    path: "/mcp",
    protocols: [McpProtocol.v2026_07_28],
  })),
)

// The server for one request: built, used once, closed with its fiber.
// Answers are JSON, read in full before the server closes.
const serve = (request: Request) =>
  Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(Server, { disableLogger: true })),
    ({ handler }) => Effect.promise(() => handler(request)),
    ({ dispose }) => Effect.promise(dispose),
  )

export default Worker.make({ fetch: serve, buffer: true })
