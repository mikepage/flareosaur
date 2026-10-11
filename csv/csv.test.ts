// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
// Many cases were originally ported from Go:
// https://github.com/golang/go/blob/go1.12.5/src/encoding/csv/
// Copyright 2011 The Go Authors. All rights reserved. BSD license.
import { Effect, Schema, Stream } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag, assertStringIncludes } from "../assert/mod.ts"
import * as Csv from "./mod.ts"

const collect = <A, E>(stream: Stream.Stream<A, E>) => Effect.map(Stream.runCollect(stream), (a) => [...a])

interface Case {
  readonly name: string
  readonly input: string
  readonly output?: ReadonlyArray<unknown>
  readonly error?: string
  readonly options?: Csv.ParseStreamOptions
}

// Cases where parse and parseStream agree.
const cases: ReadonlyArray<Case> = [
  { name: "simple", input: "a,b,c\n", output: [["a", "b", "c"]] },
  { name: "CRLF", input: "a,b\r\nc,d\r\n", output: [["a", "b"], ["c", "d"]] },
  { name: "BareCR", input: "a,b\rc,d\r\n", output: [["a", "b\rc", "d"]] },
  { name: "NoEOL", input: "a,b,c", output: [["a", "b", "c"]] },
  { name: "Semicolon", input: "a;b;c\n", output: [["a", "b", "c"]], options: { separator: ";" } },
  {
    name: "MultiLine",
    input: '"two\nline","one line","three\nline\nfield"',
    output: [["two\nline", "one line", "three\nline\nfield"]],
  },
  { name: "BlankLine", input: "a,b,c\n\nd,e,f\n\n", output: [["a", "b", "c"], ["d", "e", "f"]] },
  { name: "LeadingSpace", input: " a,  b,   c\n", output: [[" a", "  b", "   c"]] },
  { name: "trimLeadingSpace", input: " a,  b,   c\n", output: [["a", "b", "c"]], options: { trimLeadingSpace: true } },
  { name: "Comment", input: "#1,2,3\na,b,c\n#comment", output: [["a", "b", "c"]], options: { comment: "#" } },
  { name: "NoComment", input: "#1,2,3\na,b,c", output: [["#1", "2", "3"], ["a", "b", "c"]] },
  { name: "variable fields", input: "a,b,c\nd,e", output: [["a", "b", "c"], ["d", "e"]] },
  {
    name: "fieldsPerRecord inferred",
    input: "a,b,c\nd,e",
    options: { fieldsPerRecord: 0 },
    error: "Syntax error on line 2: expected 3 fields but got 2",
  },
  {
    name: "fieldsPerRecord fixed",
    input: "a,b,c\nd,e",
    options: { fieldsPerRecord: 3 },
    error: "Syntax error on line 2: expected 3 fields but got 2",
  },
  { name: "TrailingCommaEOF", input: "a,b,c,", output: [["a", "b", "c", ""]] },
  { name: "NotTrailingComma3", input: "a,b,c, \n", output: [["a", "b", "c", " "]] },
  { name: "CRLFInQuotedField", input: 'A,"Hello\r\nHi",B\r\n', output: [["A", "Hello\nHi", "B"]] },
  { name: "TrailingCR", input: "field1,field2\r", output: [["field1", "field2"]] },
  { name: "QuotedTrailingCR", input: '"field"\r', output: [["field"]] },
  { name: "FieldCRCRLF", input: "field\r\r\nfield\r\r\n", output: [["field\r"], ["field\r"]] },
  {
    name: "NonASCIISeparatorAndComment",
    input: 'a€"  b,"€ c\nλ comment\n',
    output: [["a", "  b,", " c"]],
    options: { separator: "€", comment: "λ" },
  },
  { name: "QuotedFieldMultipleLF", input: '"\n\n\n\n"', output: [["\n\n\n\n"]] },
  { name: "MultipleCRLF", input: "\r\n\r\n\r\n\r\n", output: [] },
  { name: "DoubleQuote", input: '"foo""bar"\r\n', output: [[`foo"bar`]] },
  { name: "EvenQuotes", input: `""""""""`, output: [[`"""`]] },
  { name: "BOM", input: "﻿a,b\n", output: [["a", "b"]] },
  {
    name: "header row",
    input: "a,b,c\ne,f,g\n",
    output: [{ a: "e", b: "f", c: "g" }],
    options: { skipFirstRow: true },
  },
  {
    name: "columns",
    input: "a,b,c\ne,f,g\n",
    output: [{ this: "a", is: "b", sparta: "c" }, { this: "e", is: "f", sparta: "g" }],
    options: { columns: ["this", "is", "sparta"] },
  },
  {
    name: "header row and columns",
    input: "a,b,1\nc,d,2\ne,f,3",
    output: [{ foo: "c", bar: "d", baz: "2" }, { foo: "e", bar: "f", baz: "3" }],
    options: { skipFirstRow: true, columns: ["foo", "bar", "baz"] },
  },
  {
    name: "fields do not match the header",
    input: "a,b,c\nd,e",
    options: { skipFirstRow: true, columns: ["foo", "bar", "baz"] },
    error: "Syntax error on line 2: The record has 2 fields, but the header has 3 fields",
  },
  {
    name: "bad quote in bare field",
    input: `a "word",1,2,3`,
    error: 'Syntax error on line 1; parse error on line 1, column 3: bare " in non-quoted-field',
  },
  {
    name: "bad quote in quoted field",
    input: `"wo"rd",1,2,3`,
    error: 'Syntax error on line 1; parse error on line 1, column 4: extraneous or missing " in quoted-field',
  },
  {
    name: "bad quote in quoted field with newline",
    input: `"w\n\no"rd",1,2,3`,
    error: 'Syntax error on line 1; parse error on line 3, column 2: extraneous or missing " in quoted-field',
  },
  {
    name: "lazy quotes",
    input: `a "word","1"2",a","b`,
    output: [[`a "word"`, `1"2`, `a"`, `b`]],
    options: { lazyQuotes: true },
  },
]

describe("parse", () => {
  for (const c of cases) {
    it.effect(c.name, () =>
    Effect.gen(function*() {
      const result = Csv.parse(c.input, c.options as Csv.ParseOptions)
      if (c.output) {
        assertEquals(yield* result, c.output)
      } else {
        const error = yield* assertFailsWithTag(result, "CsvError")
        assertEquals(error.kind, "Parse")
        assertStringIncludes(error.message, c.error!)
      }
    }))
  }

  it.effect("infers the result type from the options", () =>
    Effect.gen(function*() {
      const rows: Array<Array<string>> = yield* Csv.parse("a,b\n1,2\n")
      const records: Array<Record<"x" | "y", string>> = yield* Csv.parse("1,2\n", { columns: ["x", "y"] })
      assertEquals(rows, [["a", "b"], ["1", "2"]])
      assertEquals(records, [{ x: "1", y: "2" }])
    }))

  it.effect("fails on an invalid separator", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Csv.parse("a", { separator: '"' }), "CsvError")
    }))
})

describe("parseStream", () => {
  for (const c of cases) {
    it.effect(`${c.name}, in one chunk and in one-character chunks`, () =>
    Effect.gen(function*() {
      for (const chunks of [[c.input], [...c.input]]) {
        const result = collect(Stream.fromIterable(chunks).pipe(Csv.parseStream(c.options)))
        if (c.output) {
          assertEquals(yield* result, c.output)
        } else {
          const error = yield* assertFailsWithTag(result, "CsvError")
          assertStringIncludes(error.message, c.error!)
        }
      }
    }))
  }

  it.effect("emits rows before a later invalid line, counting blank lines", () =>
    Effect.gen(function*() {
      const rows: Array<Array<string>> = []
      const error = yield* assertFailsWithTag(
        Stream.make("id,name\n", "\n", "1,foo\n", '2,"baz\n').pipe(
          Csv.parseStream(),
          Stream.runForEach((row) => Effect.sync(() => rows.push(row))),
        ),
        "CsvError",
      )
      assertEquals(rows, [["id", "name"], ["1", "foo"]])
      assertStringIncludes(
        error.message,
        'Syntax error on line 4; parse error on line 5, column 1: extraneous or missing " in quoted-field',
      )
    }))

  it.effect("types records from the options", () =>
    Effect.gen(function*() {
      const records: Array<Record<string, string>> = yield* collect(
        Stream.make("a,b\n1,2\n").pipe(Csv.parseStream({ skipFirstRow: true })),
      )
      assertEquals(records, [{ a: "1", b: "2" }])
    }))
})

describe("stringify", () => {
  it.effect("stringifies arrays", () =>
    Effect.gen(function*() {
      assertEquals(yield* Csv.stringify([["Rick", 70], ["Morty", 14]]), "Rick,70\r\nMorty,14\r\n")
    }))

  it.effect("infers columns from the first object", () =>
    Effect.gen(function*() {
      assertEquals(yield* Csv.stringify([{ a: 1 }, { a: 2 }, { b: 3 }]), "a\r\n1\r\n2\r\n\r\n")
    }))

  it.effect("supports columns, renaming, nested accessors and headers: false", () =>
    Effect.gen(function*() {
      const data = [{ name: "Rick", info: { age: 70 } }, { name: "Morty", info: { age: 14 } }]
      const columns = [{ prop: "name", header: "user name" }, ["info", "age"]]
      assertEquals(yield* Csv.stringify(data, { columns }), "user name,age\r\nRick,70\r\nMorty,14\r\n")
      assertEquals(yield* Csv.stringify(data, { columns, headers: false }), "Rick,70\r\nMorty,14\r\n")
    }))

  it.effect("quotes fields and writes objects as JSON", () =>
    Effect.gen(function*() {
      assertEquals(
        yield* Csv.stringify([['a"b', "c,d", "e\nf", { x: 1 }, null]]),
        '"a""b","c,d","e\nf","{""x"":1}",\r\n',
      )
      assertEquals(yield* Csv.stringify([["a", "b"]], { separator: "\t", bom: true }), "﻿a\tb\r\n")
    }))

  it.effect("fails on an invalid separator", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Csv.stringify([["a"]], { separator: '"' }), "CsvError")
      assertEquals(error.kind, "Stringify")
    }))
})

describe("stringifyStream", () => {
  it.effect("stringifies arrays, with and without columns", () =>
    Effect.gen(function*() {
      assertEquals(yield* collect(Stream.make(["id", "name"], [1, "foo"]).pipe(Csv.stringifyStream())), [
        "id,name\r\n",
        "1,foo\r\n",
      ])
      assertEquals(
        yield* collect(Stream.make([1, "foo"], [2, "bar"]).pipe(Csv.stringifyStream({ columns: [0, 1], separator: "\t" }))),
        ["0\t1\r\n", "1\tfoo\r\n", "2\tbar\r\n"],
      )
    }))

  it.effect("stringifies objects, inferring columns from the first", () =>
    Effect.gen(function*() {
      const rows = [{ id: 1, name: "foo" }, { id: 2, name: "bar" }]
      assertEquals(yield* collect(Stream.fromIterable(rows).pipe(Csv.stringifyStream())), [
        "id,name\r\n",
        "1,foo\r\n",
        "2,bar\r\n",
      ])
      assertEquals(yield* collect(Stream.fromIterable(rows).pipe(Csv.stringifyStream({ columns: ["name"], headers: false }))), [
        "foo\r\n",
        "bar\r\n",
      ])
    }))

  it.effect("round-trips through parseStream", () =>
    Effect.gen(function*() {
      const rows = [["a", 'q"uote'], ["multi\nline", "c,omma"]]
      const text = yield* collect(Stream.fromIterable(rows).pipe(Csv.stringifyStream()))
      assertEquals(yield* collect(Stream.fromIterable(text).pipe(Csv.parseStream())), rows)
    }))

  it.effect("fails on an invalid separator", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(collect(Stream.make(["a"]).pipe(Csv.stringifyStream({ separator: "\r\n" }))), "CsvError")
    }))
})

describe("schema", () => {
  const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })

  it.effect("decodes CSV with a header row and encodes it back", () =>
    Effect.gen(function*() {
      const people = yield* Schema.decodeEffect(Csv.schema(Person))("name,age\nRick,70\nMorty,14\n")
      assertEquals(people, [{ name: "Rick", age: 70 }, { name: "Morty", age: 14 }])
      assertEquals(yield* Schema.encodeEffect(Csv.schema(Person))(people), "name,age\r\nRick,70\r\nMorty,14\r\n")
      assertEquals(
        yield* Schema.decodeEffect(Csv.schema(Person, { separator: ";" }))("name;age\nRick;70\n"),
        [{ name: "Rick", age: 70 }],
      )
    }))

  it.effect("reports CSV and schema errors as schema issues", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Schema.decodeEffect(Csv.schema(Person))('name,age\n"Rick,70\n'), "SchemaError")
      yield* assertFailsWithTag(Schema.decodeEffect(Csv.schema(Person))("name,age\nRick,old\n"), "SchemaError")
    }))

  it.effect("decodeStream decodes each record", () =>
    Effect.gen(function*() {
      const people = yield* collect(Stream.make("name,age\nRi", "ck,70\nMorty,14").pipe(Csv.decodeStream(Person)))
      assertEquals(people, [{ name: "Rick", age: 70 }, { name: "Morty", age: 14 }])
      yield* assertFailsWithTag(collect(Stream.make("name,age\nRick,old\n").pipe(Csv.decodeStream(Person))), "SchemaError")
    }))
})
