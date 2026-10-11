// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Array, Option, pipe } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertNone } from "../assert/mod.ts"
import * as Text from "./mod.ts"

describe("case conversion", () => {
  it("converts to camelCase", () => {
    assertEquals(Text.toCamelCase(""), "")
    assertEquals(Text.toCamelCase("she turned me into a newt"), "sheTurnedMeIntoANewt")
    assertEquals(Text.toCamelCase("I am up-to-date!"), "iAmUpToDate")
    assertEquals(Text.toCamelCase("Deno Is AWESOME"), "denoIsAwesome")
    assertEquals(Text.toCamelCase("HTMLElement"), "htmlElement")
  })

  it("keeps non-ASCII letters, unlike Effect's String.camelCase", () => {
    assertEquals(Text.toCamelCase("ÉcoleFrançaise"), "écoleFrançaise")
    assertEquals(Text.toCamelCase("добро пожаловать"), "доброПожаловать")
  })

  it("converts to PascalCase, snake_case, kebab-case and CONSTANT_CASE", () => {
    assertEquals(Text.toPascalCase("she turned me into a newt"), "SheTurnedMeIntoANewt")
    assertEquals(Text.toSnakeCase("I am up-to-date!"), "i_am_up_to_date")
    assertEquals(Text.toSnakeCase("some2Numbers3"), "some_2_numbers_3")
    assertEquals(Text.toKebabCase("XMLHttpRequest"), "xml-http-request")
    assertEquals(Text.toConstantCase("deno is awesome"), "DENO_IS_AWESOME")
    assertEquals(Text.toKebabCase("日本語 テスト"), "日本語-テスト")
  })

  it("converts to Title Case", () => {
    assertEquals(Text.toTitleCase("hello world"), "Hello World")
    assertEquals(Text.toTitleCase("“hello, world!”"), "“Hello, World!”")
    assertEquals(Text.toTitleCase("irrIgation", { locale: "tr-TR" }), "İrrıgation")
    assertEquals(
      Text.toTitleCase("this is what the title case function is for", { exclude: ["this", "is", "the", "for"] }),
      "This is What the Title Case Function is For",
    )
    assertEquals(
      Text.toTitleCase("here are some words that are longer than three letters", {
        exclude: ({ segment }) => segment.length <= 3,
      }),
      "Here are Some Words That are Longer Than Three Letters",
    )
  })

  it("converts to Sentence case", () => {
    assertEquals(Text.toSentenceCase("hello world"), "Hello world")
    assertEquals(Text.toSentenceCase("HELLO WORLD"), "Hello world")
    assertEquals(Text.toSentenceCase("hELLO wORLD", { trailingCase: "unchanged" }), "HELLO wORLD")
  })
})

describe("levenshteinDistance", () => {
  it("measures edit distance", () => {
    assertEquals(Text.levenshteinDistance("levenshtein", "levenshtein"), 0)
    assertEquals(Text.levenshteinDistance("sitting", "kitten"), 3)
    assertEquals(Text.levenshteinDistance("gumbo", "gambol"), 2)
    assertEquals(Text.levenshteinDistance("saturday", "sunday"), 3)
    assertEquals(Text.levenshteinDistance("", "a"), 1)
    assertEquals(Text.levenshteinDistance("", ""), 0)
    assertEquals(pipe("aarrgh", Text.levenshteinDistance("aargh")), 1)
  })
})

describe("closestString", () => {
  it("finds the closest word", () => {
    assertEquals(Text.closestString("hep", ["hi", "hello", "help"]), Option.some("help"))
    assertEquals(Text.closestString("HELP", ["hi", "hello", "help"], { caseSensitive: true }), Option.some("hi"))
    assertEquals(Text.closestString("he", ["HI", "HELLO", "HELP"], { caseSensitive: true }), Option.some("HI"))
  })

  it("returns None for no words", () => {
    assertNone(Text.closestString("he", []))
  })

  it("uses a custom distance", () => {
    const byLength = (a: string, b: string) => Math.abs(a.length - b.length)
    assertEquals(Text.closestString("abcd", ["a", "abc", "abcdefgh"], { compareFn: byLength }), Option.some("abc"))
  })
})

describe("compareSimilarity", () => {
  it("is an Order by similarity", () => {
    assertEquals(Array.sort(["hi", "hello", "help"], Text.compareSimilarity("hep")), ["help", "hi", "hello"])
    assertEquals(
      Array.sort(["hi", "hello", "help", "HOWDY"], Text.compareSimilarity("HI", { caseSensitive: true })),
      ["hi", "help", "HOWDY", "hello"],
    )
    assertEquals(Text.compareSimilarity("hep")("help", "hello"), -1)
    assertEquals(Text.compareSimilarity("hep")("help", "help"), 0)
  })
})

describe("wordSimilaritySort", () => {
  it("sorts by similarity", () => {
    assertEquals(Text.wordSimilaritySort("hep", ["length", "size", "blah", "help"]), ["help", "size", "blah", "length"])
    assertEquals(
      Text.wordSimilaritySort("hep", ["length", "Size", "blah", "HELP"], { caseSensitive: true }),
      ["Size", "blah", "HELP", "length"],
    )
    assertEquals(Text.wordSimilaritySort("", ["length", "size", "blah", "help", ""]), ["", "size", "blah", "help", "length"])
    assertEquals(Text.wordSimilaritySort("", []), [])
  })
})

describe("truncate", () => {
  it("truncates at the end by default", () => {
    assertEquals(Text.truncate("hello", 0), "")
    assertEquals(Text.truncate("hello", 10), "hello")
    assertEquals(Text.truncate("Hello, world!", 8), "Hello, …")
    assertEquals(Text.truncate("Hello, world!", 5, { suffix: "" }), "Hello")
    assertEquals(Text.truncate("Hello, world!", 2, { suffix: "..." }), "..")
  })

  it("truncates at the start or middle", () => {
    assertEquals(Text.truncate("abcdefghij", 6, { position: "start" }), "…fghij")
    assertEquals(Text.truncate("abcdefghij", 6, { position: "middle" }), "ab…hij")
  })

  it("never splits surrogate pairs", () => {
    assertEquals(Text.truncate("hello", 1, { suffix: "🦕" }), "")
  })

  it("is pipeable and normalizes maxLength", () => {
    assertEquals(pipe("Hello, world!", Text.truncate(8)), "Hello, …")
    assertEquals(pipe("Hello, world!", Text.truncate(5, { suffix: "" })), "Hello")
    assertEquals(Text.truncate("hello", -1), "")
    assertEquals(Text.truncate("hello", 4.9, { suffix: "" }), "hell")
  })
})

describe("dedent", () => {
  it("dedents strings and template literals", () => {
    assertEquals(Text.dedent("\n    a\n      b\n    c\n"), "a\n  b\nc")
    assertEquals(
      Text.dedent`
        Line ${1}
          Line ${2}
      `,
      "Line 1\n  Line 2",
    )
    assertEquals(Text.dedent("  a\n  b"), "a\nb")
  })
})

describe("slugify", () => {
  it("makes slugs", () => {
    assertEquals(Text.slugify("Hello World"), "hello-world")
    assertEquals(Text.slugify("  Hello   World  "), "hello-world")
    assertEquals(Text.slugify("Hello, world!"), "hello-world")
    assertEquals(Text.slugify("--Hello--World--"), "hello-world")
    assertEquals(Text.slugify(""), "-")
    assertEquals(Text.slugify("Συστημάτων Γραφής"), "συστημάτων-γραφής")
    assertEquals(Text.slugify("déjà vu"), "déjà-vu".normalize("NFC"))
  })

  it("strips with std's patterns", () => {
    assertEquals(Text.slugify("déjà vu", { strip: Text.SlugifyStrip.diacritics }), "deja-vu")
    assertEquals(Text.slugify("Συστημάτων Γραφής", { strip: Text.SlugifyStrip.nonAscii }), "-")
    assertEquals(Text.slugify("abcdef", { strip: /[ace]/g }), "bdf")
  })
})

describe("reverse", () => {
  it("reverses, keeping Unicode intact", () => {
    assertEquals(Text.reverse("hello"), "olleh")
    assertEquals(Text.reverse("mañana"), "anañam")
    assertEquals(Text.reverse("👍🏽!"), "!👍🏽".replace("👍🏽", "🏽👍"))
    assertEquals(Text.reverse("ab", { handleUnicode: false }), "ba")
  })
})

describe("longestCommonPrefix", () => {
  it("finds the shared prefix", () => {
    assertEquals(Text.longestCommonPrefix([]), "")
    assertEquals(Text.longestCommonPrefix(["flower"]), "flower")
    assertEquals(Text.longestCommonPrefix(["flower", "flow", "flight"]), "fl")
    assertEquals(Text.longestCommonPrefix(new Set(["dog", "racecar"])), "")
  })
})

describe("trimBy", () => {
  it("trims both ends, data-first and piped", () => {
    assertEquals(Text.trimBy("/pathname/", "/"), "pathname")
    assertEquals(Text.trimBy("/pathname/", ["/"]), "pathname")
    assertEquals(Text.trimBy("abc", /[abc]/), "")
    assertEquals(Text.trimBy("¡¿Seguro que no?!", /[^\p{L}\p{M}\p{N}]/u), "Seguro que no")
    assertEquals(pipe("--x--", Text.trimBy("-")), "x")
  })

  it("trims the start or the end", () => {
    assertEquals(Text.trimStartBy("/pathname/", "/"), "pathname/")
    assertEquals(Text.trimStartBy("https://sth.example.com", "https://"), "sth.example.com")
    assertEquals(Text.trimStartBy("https://sth.example.com", new Set("https://")), ".example.com")
    assertEquals(Text.trimEndBy("/pathname/", "/"), "/pathname")
    assertEquals(pipe("abc", Text.trimStartBy(/[ab]/)), "c")
    assertEquals(pipe("abc", Text.trimEndBy("c")), "ab")
    assertEquals(Text.trimStartBy("abc", ""), "abc")
  })
})
