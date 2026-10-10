// Copyright 2018-2026 the Deno authors. MIT license.

import { assertEquals } from "@flareosaur/assert";
import { TextDelimiterStream } from "@flareosaur/streams/text-delimiter-stream";
import { TextLineStream } from "@flareosaur/streams/text-line-stream";
import { JsonParseStream } from "./parse_stream.ts";
import { assertInvalidParse, assertValidParse } from "./_test_utils.ts";

Deno.test({
  name: "JsonParseStream",
  async fn() {
    await assertValidParse(
      JsonParseStream,
      ['{"foo": "bar"}', '["foo"]', '"foo"', "0", "null", "true", "false"],
      [{ foo: "bar" }, ["foo"], "foo", 0, null, true, false],
    );
  },
});

Deno.test({
  name: "JsonParseStream handles empty line",
  async fn() {
    await assertValidParse(
      JsonParseStream,
      [" \t\r\n", ""],
      [],
    );
  },
});

Deno.test({
  name: "JsonParseStream handles special character",
  async fn() {
    await assertValidParse(
      JsonParseStream,
      ['"👪"', '"🦕"', '"\u3053\u3093\u306b\u3061\u306f"'],
      ["👪", "🦕", "\u3053\u3093\u306b\u3061\u306f"],
    );
  },
});

Deno.test({
  name: "JsonParseStream handles expect error",
  async fn() {
    await assertInvalidParse(
      JsonParseStream,
      ['{"foo": "bar"}', '{"foo": '],
      SyntaxError,
      `Unexpected end of JSON input (parsing: '{"foo": ')`,
    );
  },
});

Deno.test({
  name: "parse() handles jsonl testdata",
  async fn() {
    // Read the test data file
    const url = "./testdata/test.jsonl";
    const { body } = await fetch(new URL(url, import.meta.url).toString());
    const readable = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .pipeThrough(new JsonParseStream());

    const result = await Array.fromAsync(readable);

    assertEquals(result, [
      { "hello": "world" },
      ["👋", "👋", "👋"],
      { "deno": "🦕" },
    ]);
  },
});

Deno.test({
  name: "parse() handles ndjson testdata",
  async fn() {
    // Read the test data file
    const url = "./testdata/test.ndjson";
    const { body } = await fetch(new URL(url, import.meta.url).toString());
    const readable = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .pipeThrough(new JsonParseStream());

    const result = await Array.fromAsync(readable);

    assertEquals(result, [
      { "hello": "world" },
      ["👋", "👋", "👋"],
      { "deno": "🦕" },
    ]);
  },
});

Deno.test({
  name: "parse() handles json-seq testdata",
  async fn() {
    // Read the test data file
    const recordSeparator = "\x1E";

    const url = "./testdata/test.json-seq";
    const { body } = await fetch(new URL(url, import.meta.url).toString());
    const readable = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextDelimiterStream(recordSeparator))
      .pipeThrough(new JsonParseStream());

    const result = await Array.fromAsync(readable);

    assertEquals(result, [
      { "hello": "world" },
      ["👋", "👋", "👋"],
      { "deno": "🦕" },
    ]);
  },
});
