/**
 * @title Extract front matter from Markdown
 * @difficulty beginner
 * @tags workers, encoding, markdown
 * @group Data formats
 * @resource {https://jekyllrb.com/docs/front-matter/} Front matter
 * @check GET / -> 200 "title: Hello, Workers" "tags: effect, deno" "body starts: # Hello" "invalid date: SchemaError"
 *
 * Front matter is a metadata block at the top of a Markdown file, in YAML,
 * TOML or JSON. `extract` finds the format, parses the block and returns
 * the rest of the document; with a Schema the attributes come out typed.
 */

import { Console, Effect, Schema } from "effect"
import * as FrontMatter from "@mikepage/flareosaur/front-matter"
import { script } from "./_lib/script.ts"

const Post = Schema.Struct({
  title: Schema.String,
  date: Schema.Date,
  tags: Schema.Array(Schema.String),
})

const markdown = `---
title: Hello, Workers
date: 2026-10-11
tags: [effect, deno]
---
# Hello

This post was parsed by a Worker.
`

const program = Effect.gen(function*() {
  const { attrs, body } = yield* FrontMatter.extract(markdown)
  yield* Console.log(`raw attrs: ${JSON.stringify(attrs)}`)

  // Decode the attributes into a typed post.
  const post = yield* Schema.decodeUnknownEffect(Post)(attrs)
  yield* Console.log(`title: ${post.title}`)
  yield* Console.log(`tags: ${post.tags.join(", ")}`)
  yield* Console.log(`body starts: ${body.split("\n")[0]}`)

  const broken = markdown.replace("2026-10-11", "someday")
  const error = yield* Effect.flip(
    Effect.flatMap(FrontMatter.extract(broken), ({ attrs }) => Schema.decodeUnknownEffect(Post)(attrs)),
  )
  yield* Console.log(`invalid date: ${error._tag}`)
})

export default script(program)
