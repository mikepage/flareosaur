/**
 * @title HTTP server: CORS
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS} MDN: CORS
 * @check OPTIONS /api/data h:origin=https://app.example.com h:access-control-request-method=POST -> 204 header:access-control-allow-origin~"https://app.example.com"
 * @check GET /api/data h:origin=https://app.example.com -> 200 "ok" header:access-control-allow-origin~"https://app.example.com"
 *
 * Browsers block cross-origin requests unless the server opts in. Add
 * `HttpRouter.cors` to the routes and the router answers preflight requests
 * and adds the CORS headers to every response.
 */

import { Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const routes = HttpRouter.add("GET", "/api/data", HttpServerResponse.jsonUnsafe({ status: "ok" }))

export default Worker.make({
  fetch: Layer.mergeAll(
    routes,
    HttpRouter.cors({
      allowedOrigins: ["https://app.example.com"],
      allowedMethods: ["GET", "POST"],
      maxAge: 600,
    }),
  ),
})
