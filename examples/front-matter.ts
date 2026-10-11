/**
 * @title Extract front matter from Markdown
 * @difficulty beginner
 * @tags workers, encoding, markdown
 * @group Data formats
 * @resource {https://jsr.io/@std/front-matter} @std/front-matter
 * @resource {https://jekyllrb.com/docs/front-matter/} Front matter
 * @check GET / -> 200 "title: Hello, Workers" "tags: workers, deno" "date: 2026-10-11" "body starts: # Hello" "toml title: From TOML" "invalid date: TypeError"
 *
 * Front matter is a metadata block at the top of a Markdown file, in YAML,
 * TOML or JSON. std's `extract` finds the format, parses the block and
 * returns the rest of the document. The attributes are untyped, so check
 * them before use.
 */

import { extract } from "@mikepage/flareosaur/front-matter/any";
import { script } from "./_lib/script.ts";

interface Post {
  title: string;
  date: Date;
  tags: string[];
}

// Front matter is input like any other. Check the shape and throw on
// anything unexpected.
function toPost(attrs: Record<string, unknown>): Post {
  const { title, date, tags } = attrs;
  if (typeof title !== "string") throw new TypeError("title must be text");
  if (!(date instanceof Date)) throw new TypeError("date must be a date");
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
    throw new TypeError("tags must be a list of text");
  }
  return { title, date, tags };
}

const markdown = `---
title: Hello, Workers
date: 2026-10-11
tags: [workers, deno]
---
# Hello

This post was parsed by a Worker.
`;

export default script((print) => {
  // YAML front matter sits between --- lines. YAML turns the date into a
  // Date object.
  const { attrs, body } = extract<Record<string, unknown>>(markdown);
  const post = toPost(attrs);
  print(`title: ${post.title}`);
  print(`date: ${post.date.toISOString().slice(0, 10)}`);
  print(`tags: ${post.tags.join(", ")}`);
  print(`body starts: ${body.split("\n")[0]}`);

  // TOML front matter uses +++ (or ---toml).
  const toml = extract<{ title: string }>(
    `+++\ntitle = "From TOML"\n+++\nBody`,
  );
  print(`toml title: ${toml.attrs.title}`);

  // A date that is not a date fails the check.
  try {
    toPost(
      extract<Record<string, unknown>>(
        markdown.replace("2026-10-11", "someday"),
      ).attrs,
    );
  } catch (error) {
    print(`invalid date: ${error instanceof Error ? error.name : error}`);
  }
});
