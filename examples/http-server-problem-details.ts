/**
 * @title Errors as problem details
 * @difficulty intermediate
 * @tags workers, http
 * @group HTTP
 * @resource {https://www.rfc-editor.org/rfc/rfc9457} RFC 9457: Problem Details for HTTP APIs
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/URLPattern} MDN: URLPattern
 * @resource {https://jsr.io/@std/http/doc/unstable-problem-details} @std/http: problem details
 * @check GET /accounts/1 -> 200 "Ada"
 * @check GET /accounts/2 -> 404 "\"title\":\"Not Found\"" "account 2 does not exist" header:content-type~"application/problem+json"
 * @check POST /accounts/1/withdraw/500 -> 403 "insufficient funds" "\"balance\":100"
 * @check GET /nowhere -> 404 "\"type\":\"about:blank\""
 *
 * APIs should report errors in a format clients can rely on. RFC 9457
 * problem details are JSON with `type`, `title`, `status` and `detail`.
 * Handlers throw a `Problem`, and one catch at the top turns it into an
 * `application/problem+json` response.
 */

import { createProblemDetailsResponse } from "@mikepage/flareosaur/http/unstable-problem-details";

// A frozen sample dataset. Real accounts would live in D1 or KV.
const ACCOUNTS: ReadonlyMap<number, { name: string; balance: number }> =
  new Map([[1, { name: "Ada", balance: 100 }]]);

// An error that knows its HTTP status, a detail, and any extra members.
class Problem extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail);
  }
}

function findAccount(id: number) {
  const account = ACCOUNTS.get(id);
  if (!account) throw new Problem(404, `account ${id} does not exist`);
  return account;
}

// URLPattern matches the path and captures the named groups.
const ACCOUNT = new URLPattern({ pathname: "/accounts/:id(\\d+)" });
const WITHDRAW = new URLPattern({
  pathname: "/accounts/:id(\\d+)/withdraw/:amount(\\d+)",
});

function route(request: Request): Response {
  const account = ACCOUNT.exec(request.url);
  if (request.method === "GET" && account) {
    return Response.json(findAccount(Number(account.pathname.groups.id)));
  }
  const withdraw = WITHDRAW.exec(request.url);
  if (request.method === "POST" && withdraw) {
    const { id, amount } = withdraw.pathname.groups;
    const found = findAccount(Number(id));
    if (Number(amount) > found.balance) {
      throw new Problem(403, "insufficient funds", { balance: found.balance });
    }
    return new Response("ok");
  }
  throw new Problem(
    404,
    `no route for ${request.method} ${new URL(request.url).pathname}`,
  );
}

export default {
  fetch(request: Request): Response {
    try {
      return route(request);
    } catch (error) {
      if (!(error instanceof Problem)) throw error;
      // The title defaults to the status text ("Not Found") and the type
      // to "about:blank". Extension members sit next to the standard ones.
      return createProblemDetailsResponse({
        ...error.extensions,
        status: error.status,
        detail: error.detail,
      });
    }
  },
} satisfies ExportedHandler;
