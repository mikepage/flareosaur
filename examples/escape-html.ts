/**
 * @title Escape HTML, CSS and JavaScript
 * @difficulty beginner
 * @tags workers, html, security
 * @group Standard library
 * @resource {https://owasp.org/www-community/attacks/xss/} OWASP: cross-site scripting
 * @check GET /?name=%3Cscript%3Ealert(1)%3C%2Fscript%3E -> 200 "&lt;script&gt;alert(1)&lt;/script&gt;" !"<script>alert" header:content-type~"text/html"
 *
 * Putting user input into HTML without escaping it opens the door to
 * cross-site scripting. `safeHtml` is a template tag that escapes every
 * interpolated value, so the safe way is also the short way.
 */

import { Effect } from "effect"
import { safeHtml } from "@mikepage/flareosaur/html"
import * as Worker from "@mikepage/flareosaur/workers/worker"

export default Worker.make({
  fetch: (request) =>
    Effect.sync(() => {
      const name = new URL(request.url).searchParams.get("name") ?? "stranger"
      // Every ${...} is escaped; the template's own markup is not.
      const page = safeHtml`<!doctype html><h1>Hello, ${name}!</h1>`
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
    }),
})
