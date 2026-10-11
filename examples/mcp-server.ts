/**
 * @title Build an MCP server
 * @difficulty intermediate
 * @tags workers, ai, mcp
 * @group AI
 * @resource {https://modelcontextprotocol.io} Model Context Protocol
 * @resource {https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http} MCP: Streamable HTTP transport
 * @resource {https://www.jsonrpc.org/specification} JSON-RPC 2.0
 * @check POST /mcp h:content-type=application/json h:accept="application/json, text/event-stream" {"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}} -> 200 "\"protocolVersion\":\"2025-06-18\"" "flareosaur examples"
 * @check POST /mcp h:content-type=application/json {"jsonrpc":"2.0","method":"notifications/initialized"} -> 202
 * @check POST /mcp h:content-type=application/json h:accept="application/json, text/event-stream" h:mcp-protocol-version=2026-07-28 h:mcp-method=tools/list {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"check","version":"1"}}}} -> 200 "convert_temperature" "roll_dice"
 * @check POST /mcp h:content-type=application/json h:accept="application/json, text/event-stream" h:mcp-protocol-version=2026-07-28 h:mcp-method=tools/call h:mcp-name=convert_temperature {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"convert_temperature","arguments":{"celsius":100},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"check","version":"1"}}}} -> 200 "212"
 * @check POST /mcp h:content-type=application/json {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"convert_temperature","arguments":{"celsius":"hot"}}} -> 200 "\"isError\":true"
 * @check POST /mcp h:content-type=application/json {"jsonrpc":"2.0","id":4,"method":"resources/list"} -> 200 "-32601"
 *
 * The Model Context Protocol is how AI assistants call tools you host. Over
 * Streamable HTTP it is plain JSON-RPC 2.0: the client POSTs one message to
 * `/mcp` and the server answers it with JSON. No SDK is needed.
 *
 * This server is stateless: it keeps no session, so it doesn't matter which
 * isolate a call lands on, and every request is answered on its own. For
 * server-to-client features (sampling, elicitation, notifications) put the
 * server in a Durable Object instead.
 */

const SERVER_INFO = { name: "flareosaur examples", version: "1.0.0" };
const PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
];

// A tool is a name, a description, a JSON Schema for its arguments and a
// function. The function returns text for the model, or throws.
interface Tool {
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>): string;
}

const TOOLS: Record<string, Tool> = {
  convert_temperature: {
    description: "Convert a temperature from Celsius to Fahrenheit",
    inputSchema: {
      type: "object",
      properties: { celsius: { type: "number" } },
      required: ["celsius"],
    },
    call({ celsius }) {
      if (typeof celsius !== "number") {
        throw new Error("celsius must be a number");
      }
      return `${celsius * 9 / 5 + 32}`;
    },
  },
  roll_dice: {
    description: "Roll a die with the given number of sides",
    inputSchema: {
      type: "object",
      properties: { sides: { type: "integer", minimum: 2, default: 6 } },
    },
    call({ sides = 6 }) {
      if (typeof sides !== "number" || sides < 2) {
        throw new Error("sides must be 2 or more");
      }
      const [n] = crypto.getRandomValues(new Uint32Array(1));
      return `${(n! % sides) + 1}`;
    },
  },
};

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

// Answers one JSON-RPC request with its result, or throws an RpcError.
function handle({ method, params = {} }: JsonRpcRequest): unknown {
  switch (method) {
    case "initialize": {
      // Agree on the client's version if we know it, else offer our latest.
      const asked = String(params.protocolVersion);
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked)
          ? asked
          : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: Object.entries(TOOLS).map((
          [name, { description, inputSchema }],
        ) => ({
          name,
          description,
          inputSchema,
        })),
      };
    case "tools/call": {
      const tool = TOOLS[String(params.name)];
      if (!tool) throw new RpcError(-32602, `unknown tool: ${params.name}`);
      // A tool's own failure is a result with isError, so the model can read
      // it and try again. Protocol errors are for broken requests.
      try {
        const text = tool.call(
          (params.arguments ?? {}) as Record<string, unknown>,
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
    default:
      throw new RpcError(-32601, `method not found: ${method}`);
  }
}

const rpc = (body: unknown) =>
  Response.json(body, { headers: { "content-type": "application/json" } });

export default {
  async fetch(request) {
    if (new URL(request.url).pathname !== "/mcp") {
      return new Response("not found", { status: 404 });
    }
    // GET would open a stream for server-sent messages. A stateless server
    // has none to send.
    if (request.method !== "POST") {
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }

    const message = await request.json().catch(() => null) as
      | JsonRpcRequest
      | null;
    if (!message || Array.isArray(message) || message.jsonrpc !== "2.0") {
      return rpc({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "invalid request" },
      });
    }

    // A notification (no id) gets no answer, just 202 Accepted.
    if (message.id === undefined) return new Response(null, { status: 202 });

    try {
      return rpc({ jsonrpc: "2.0", id: message.id, result: handle(message) });
    } catch (error) {
      const { code, message: text } = error instanceof RpcError
        ? error
        : { code: -32603, message: "internal error" };
      return rpc({
        jsonrpc: "2.0",
        id: message.id,
        error: { code, message: text },
      });
    }
  },
} satisfies ExportedHandler;
