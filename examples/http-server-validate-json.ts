/**
 * @title Validate JSON bodies
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Request/json} MDN: Request.json()
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400} MDN: 400 Bad Request
 * @check POST /users h:content-type=application/json {"name":"Ada","email":"ada@example.com","age":36} -> 201 "Ada" "ada@example.com"
 * @check POST /users h:content-type=application/json {"name":"","email":"nope"} -> 400 "Invalid user" "name: expected a non-empty string" "email: expected an email address"
 * @check POST /users h:content-type=application/json {"name":"Ada", -> 400 "Body is not valid JSON"
 * @check POST /users h:content-type=text/plain hello -> 415
 *
 * Never trust a request body. `request.json()` parses it, but the result is
 * whatever the client sent. Check it field by field before using it, and
 * answer with a 400 that says exactly what is wrong. No schema library
 * needed for a handful of fields.
 */

interface NewUser {
  name: string;
  email: string;
  age?: number;
}

// Returns the user, or the list of problems with the input.
function validateUser(input: unknown): NewUser | string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return ["body: expected a JSON object"];
  }
  // Index the object as a record of unknowns; every field is checked below.
  const { name, email, age } = input as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof name !== "string" || name.trim() === "") {
    problems.push("name: expected a non-empty string");
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    problems.push("email: expected an email address");
  }
  if (age !== undefined && (!Number.isInteger(age) || (age as number) < 0)) {
    problems.push("age: expected a whole number >= 0");
  }
  if (problems.length) return problems;
  // Build a fresh object, so unknown fields the client sent are dropped.
  return {
    name: name as string,
    email: email as string,
    ...(age === undefined ? {} : { age: age as number }),
  };
}

async function createUser(request: Request): Promise<Response> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/json")) {
    return new Response("Expected application/json", { status: 415 });
  }
  // json() rejects with a SyntaxError on malformed JSON.
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Body is not valid JSON" }, { status: 400 });
  }
  const user = validateUser(input);
  if (Array.isArray(user)) {
    return Response.json({ error: "Invalid user", details: user }, {
      status: 400,
    });
  }
  return Response.json({ id: crypto.randomUUID(), ...user }, { status: 201 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/users") {
      return await createUser(request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
