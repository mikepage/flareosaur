/**
 * @title Paginating results
 * @difficulty intermediate
 * @tags workers, http
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams} MDN: URLSearchParams
 * @resource {https://jsr.io/@std/encoding/doc/base64url} @std/encoding: base64url
 * @check GET /items -> 200 "\"total\":42" "\"items\":[1,2,3,4,5,6,7,8,9,10]" "cursor=MTA"
 * @check GET /items?limit=5&cursor=NDA -> 200 "\"items\":[41,42]" "\"next\":null"
 * @check GET /items?limit=500 -> 400 "limit must be"
 * @check GET /items?cursor=!!! -> 400 "bad cursor"
 *
 * APIs that return lists need pagination. The query parameters are
 * validated (with a default and limits), and the cursor is opaque to the
 * client: a base64url offset it hands back to get the next page.
 */

import {
  decodeBase64Url,
  encodeBase64Url,
} from "@mikepage/flareosaur/encoding/base64url";

// A frozen sample dataset: the numbers 1 to 42.
const ITEMS: readonly number[] = Array.from({ length: 42 }, (_, i) => i + 1);

const badRequest = (message: string) => new Response(message, { status: 400 });

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (url.pathname !== "/items") {
      return new Response("Not Found", { status: 404 });
    }

    // URLSearchParams gives strings or null. Validate them by hand.
    const limit = Number(url.searchParams.get("limit") ?? 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return badRequest("limit must be an integer from 1 to 100");
    }

    // The cursor is a base64url-encoded offset. Anything else is rejected.
    let offset = 0;
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null) {
      try {
        offset = Number(new TextDecoder().decode(decodeBase64Url(cursor)));
      } catch {
        offset = NaN;
      }
      if (!Number.isInteger(offset) || offset < 0) {
        return badRequest("bad cursor");
      }
    }

    const items = ITEMS.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    // Only link to a next page when there is one.
    const next = nextOffset < ITEMS.length
      ? `/items?limit=${limit}&cursor=${encodeBase64Url(String(nextOffset))}`
      : null;
    return Response.json({ total: ITEMS.length, items, next });
  },
} satisfies ExportedHandler;
