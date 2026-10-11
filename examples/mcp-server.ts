/**
 * @title Build an MCP server
 * @difficulty intermediate
 * @tags workers, ai, mcp
 * @group AI
 * @resource {https://modelcontextprotocol.io} Model Context Protocol
 * @resource {https://github.com/Effect-TS/effect/blob/main/packages/effect/MCP.md} Effect: MCP server
 * @check POST /mcp h:content-type=application/json h:accept="application/json, text/event-stream" {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}} -> 200 "flareosaur examples"
 * @check POST /mcp h:content-type=application/json h:accept="application/json, text/event-stream" h:mcp-session-id="{{prev:mcp-session-id}}" h:mcp-protocol-version=2025-06-18 {"jsonrpc":"2.0","id":2,"method":"tools/list"} -> 200 "convert_temperature"
 * @check POST /mcp h:content-type=application/json h:accept="application/json, text/event-stream" h:mcp-session-id="{{prev:mcp-session-id}}" h:mcp-protocol-version=2025-06-18 {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"convert_temperature","arguments":{"celsius":100}}} -> 200 "212"
 *
 * The Model Context Protocol is how AI assistants call tools you host. A
 * Worker is a good place for an MCP server: public, fast, cheap. Effect's
 * `McpServer` serves tools defined with Schemas over MCP's HTTP transport,
 * as routes on the Worker's `HttpRouter`. Parameters are decoded and results
 * encoded by the Schemas, so a model gets typed errors instead of crashes.
 */

import { Effect, Layer, Schema } from "effect"
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
    protocols: [McpProtocol.v2025_06_18],
  })),
)

export default Worker.make({ fetch: Server })
