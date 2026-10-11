/**
 * @title Escape HTML, CSS and JavaScript
 * @difficulty beginner
 * @tags workers, html, security
 * @group Standard library
 * @resource {https://jsr.io/@std/html} @std/html
 * @resource {https://owasp.org/www-community/attacks/xss/} OWASP: cross-site scripting
 * @check GET /?name=%3Cscript%3Ealert(1)%3C%2Fscript%3E -> 200 "&lt;script&gt;alert(1)&lt;/script&gt;" !"<script>alert" !"</script>\"" header:content-type~"text/html"
 * @check GET /?name=Ada -> 200 "Hello, Ada!" "const name = \"Ada\";"
 * @check GET /?name=1st -> 200 "#\\31 st"
 *
 * Putting user input into HTML without escaping it opens the door to
 * cross-site scripting. Each context needs its own escaping: std's
 * `escape` for HTML text and attributes, `escapeJs` for a value inside a
 * `<script>`, and `escapeCss` for a value inside a `<style>`.
 */

import { escape } from "@mikepage/flareosaur/html";
import { escapeCss } from "@mikepage/flareosaur/html/unstable-escape-css";
import { escapeJs } from "@mikepage/flareosaur/html/unstable-escape-js";

export default {
  fetch(request): Response {
    const name = new URL(request.url).searchParams.get("name") ?? "stranger";

    // escape replaces & < > " and ' with entities. Use it for text and
    // quoted attribute values.
    const html = escape(name);

    // escapeJs writes the value as a JSON literal and breaks up any
    // "</script" or "<!--" inside it, so it cannot end the script element.
    const js = escapeJs(name);

    // escapeCss makes the value safe as a CSS identifier or string.
    const css = escapeCss(name);

    const page = `<!doctype html>
<style>#${css} { color: teal; }</style>
<h1 id="${html}">Hello, ${html}!</h1>
<script>const name = ${js}; console.log(name);</script>
`;
    return new Response(page, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
} satisfies ExportedHandler;
