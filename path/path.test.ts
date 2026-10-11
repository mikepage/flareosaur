// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Path as EffectPath } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFalse } from "../assert/mod.ts"
import * as Path from "./mod.ts"
import * as Posix from "./Posix.ts"
import * as Windows from "./Windows.ts"

describe("Posix", () => {
  it("basename, dirname, extname", () => {
    assertEquals(Posix.basename("/home/user/mod.ts"), "mod.ts")
    assertEquals(Posix.basename("/home/user/mod.ts", ".ts"), "mod")
    assertEquals(Posix.basename("/dir/"), "dir")
    assertEquals(Posix.dirname("/a/b/c"), "/a/b")
    assertEquals(Posix.dirname("a"), ".")
    assertEquals(Posix.extname("file.tar.gz"), ".gz")
    assertEquals(Posix.extname(".profile"), "")
  })

  it("join and normalize", () => {
    assertEquals(Posix.join("/foo", "bar", "baz/asdf", "quux", ".."), "/foo/bar/baz/asdf")
    assertEquals(Posix.join(), ".")
    assertEquals(Posix.join("", ""), ".")
    assertEquals(Posix.normalize("/foo/bar//baz/asdf/quux/.."), "/foo/bar/baz/asdf")
    assertEquals(Posix.normalize("./a/../../b"), "../b")
  })

  it("parse and format round-trip", () => {
    const parsed = Posix.parse("/home/user/dir/file.txt")
    assertEquals(parsed, { root: "/", dir: "/home/user/dir", base: "file.txt", ext: ".txt", name: "file" })
    assertEquals(Posix.format(parsed), "/home/user/dir/file.txt")
  })

  it("isAbsolute and toNamespacedPath", () => {
    assert(Posix.isAbsolute("/a"))
    assertFalse(Posix.isAbsolute("a/b"))
    assertEquals(Posix.toNamespacedPath("/path/to/file.txt"), "/path/to/file.txt")
  })

  it("resolve uses / as the working directory", () => {
    assertEquals(Posix.resolve("/var/lib", "../", "file/"), "/var/file")
    assertEquals(Posix.resolve("/var/lib", "/../", "file/"), "/file")
    assertEquals(Posix.resolve("/some/dir", ".", "/absolute/"), "/absolute")
    assertEquals(Posix.resolve("/foo/tmp.3/", "../tmp.3/cycles/root.js"), "/foo/tmp.3/cycles/root.js")
    assertEquals(Posix.resolve("a/b/c/", "../../.."), "/")
    assertEquals(Posix.resolve("."), "/")
    assertEquals(Posix.resolve(""), "/")
    assertEquals(Posix.resolve("a", "b"), "/a/b")
  })

  it("relative", () => {
    assertEquals(Posix.relative("/var/lib", "/var"), "..")
    assertEquals(Posix.relative("/var/lib", "/bin"), "../../bin")
    assertEquals(Posix.relative("/var/lib", "/var/lib"), "")
    assertEquals(Posix.relative("/var/lib", "/var/apache"), "../apache")
    assertEquals(Posix.relative("/page1/page2/foo", "/"), "../../..")
    assertEquals(Posix.relative("a", "a/b"), "b")
    assertEquals(Posix.relative("", "/"), "")
  })

  it("common", () => {
    assertEquals(Posix.common(["file://deno/cli/js/deno.ts", "file://deno/std/path/mod.ts"]), "file://deno/")
    assertEquals(Posix.common(["file://deno/cli/js/deno.ts", "https://deno.land/std/path/mod.ts"]), "")
    assertEquals(Posix.common(["./deno/std/path/mod.ts", "./deno/std/path/mod.ts"]), "./deno/std/path/mod.ts")
  })

  it.effect("fromFileUrl", () =>
    Effect.gen(function*() {
      assertEquals(yield* Posix.fromFileUrl(new URL("file:///home/foo")), "/home/foo")
      assertEquals(yield* Posix.fromFileUrl("file:///"), "/")
      assertEquals(yield* Posix.fromFileUrl("file:///home/foo%20bar"), "/home/foo bar")
      assertEquals(yield* Posix.fromFileUrl("file:///%"), "/%")
      assertEquals(yield* Posix.fromFileUrl("file://localhost/foo"), "/foo")
      assertEquals(yield* Posix.fromFileUrl("file:///C:/Users/"), "/C:/Users/")
      const error = yield* assertFailsWithTag(Posix.fromFileUrl("http://localhost/foo"), "BadArgument")
      assertEquals(error.method, "fromFileUrl")
      yield* assertFailsWithTag(Posix.fromFileUrl("not a url"), "BadArgument")
    }))

  it.effect("toFileUrl", () =>
    Effect.gen(function*() {
      assertEquals((yield* Posix.toFileUrl("/home/foo")).href, "file:///home/foo")
      assertEquals((yield* Posix.toFileUrl("/home/ ")).href, "file:///home/%20")
      assertEquals((yield* Posix.toFileUrl("/home/%20")).href, "file:///home/%2520")
      assertEquals((yield* Posix.toFileUrl("/home\\foo")).href, "file:///home%5Cfoo")
      assertEquals((yield* Posix.toFileUrl("//localhost/")).href, "file:///localhost/")
      yield* assertFailsWithTag(Posix.toFileUrl("foo"), "BadArgument")
      yield* assertFailsWithTag(Posix.toFileUrl("./foo"), "BadArgument")
    }))

  it("globToRegExp", () => {
    assert(Posix.globToRegExp("*.ts").test("mod.ts"))
    assertFalse(Posix.globToRegExp("*.ts").test("dir/mod.ts"))
    assert(Posix.globToRegExp("**/*.ts").test("a/b/mod.ts"))
    assertFalse(Posix.globToRegExp("**/*.ts", { globstar: false }).test("a/b/mod.ts"))
    assert(Posix.globToRegExp("*.{ts,js}").test("a.js"))
    assertFalse(Posix.globToRegExp("+(a).txt", { extended: false }).test("aa.txt"))
    assert(Posix.globToRegExp("A.TS", { caseInsensitive: true }).test("a.ts"))
    assert(Posix.globToRegExp("[[:digit:]]?").test("1a"))
    assert(Posix.globToRegExp("!(foo).txt").test("bar.txt"))
    assertFalse(Posix.globToRegExp("!(foo).txt").test("foo.txt"))
    assertFalse(Posix.globToRegExp("").test(""))
  })

  it("isGlob", () => {
    assert(Posix.isGlob("*.ts"))
    assert(Posix.isGlob("a/?.ts"))
    assert(Posix.isGlob("{a,b}"))
    assert(Posix.isGlob("[abc]"))
    assertFalse(Posix.isGlob("mod.ts"))
    assertFalse(Posix.isGlob("\\*.ts"))
  })

  it("joinGlobs and normalizeGlob", () => {
    assertEquals(Posix.joinGlobs(["foo", "bar", "..", "baz"]), "foo/baz")
    assertEquals(Posix.joinGlobs(["**", "..", "x"]), "x")
    assertEquals(Posix.joinGlobs(["**", "..", "x"], { globstar: true }), "**/../x")
    assertEquals(Posix.normalizeGlob("foo/bar/../baz"), "foo/baz")
    assertEquals(Posix.normalizeGlob("foo/**/../bar"), "foo/bar")
    assertEquals(Posix.normalizeGlob("foo/**/../bar", { globstar: true }), "foo/**/../bar")
  })

  it("constants", () => {
    assertEquals(Posix.SEPARATOR, "/")
    assertEquals(Posix.DELIMITER, ":")
    assertEquals("a//b".split(Posix.SEPARATOR_PATTERN), ["a", "b"])
  })
})

describe("Windows", () => {
  it("basename, dirname, extname", () => {
    assertEquals(Windows.basename("C:\\dir\\file.txt"), "file.txt")
    assertEquals(Windows.basename("C:\\dir\\file.txt", ".txt"), "file")
    assertEquals(Windows.dirname("C:\\a\\b"), "C:\\a")
    assertEquals(Windows.dirname("\\\\server\\share\\dir"), "\\\\server\\share\\")
    assertEquals(Windows.extname("C:\\a\\b.md"), ".md")
  })

  it("join, normalize, parse, format", () => {
    assertEquals(Windows.join("C:\\a", "b", "..\\c"), "C:\\a\\c")
    assertEquals(Windows.join("//server", "share"), "\\\\server\\share\\")
    assertEquals(Windows.join(), ".")
    assertEquals(Windows.normalize("C:/a//b\\..\\c"), "C:\\a\\c")
    const parsed = Windows.parse("C:\\path\\dir\\index.html")
    assertEquals(parsed, { root: "C:\\", dir: "C:\\path\\dir", base: "index.html", ext: ".html", name: "index" })
    assertEquals(Windows.format(parsed), "C:\\path\\dir\\index.html")
  })

  it("isAbsolute", () => {
    assert(Windows.isAbsolute("C:\\a"))
    assert(Windows.isAbsolute("\\\\server\\share"))
    assertFalse(Windows.isAbsolute("C:a"))
    assertFalse(Windows.isAbsolute("a\\b"))
  })

  it("resolve uses C:\\ as the working directory", () => {
    assertEquals(Windows.resolve("c:/blah\\blah", "d:/games", "c:../a"), "c:\\blah\\a")
    assertEquals(Windows.resolve("c:/ignore", "d:\\a/b\\c/d", "\\e.exe"), "d:\\e.exe")
    assertEquals(Windows.resolve("c:/ignore", "c:/some/file"), "c:\\some\\file")
    assertEquals(Windows.resolve("d:/ignore", "d:some/dir//"), "d:\\ignore\\some\\dir")
    assertEquals(Windows.resolve("//server/share", "..", "relative\\"), "\\\\server\\share\\relative")
    assertEquals(Windows.resolve("c:/", "//"), "c:\\")
    assertEquals(Windows.resolve("c:/", "//dir"), "c:\\dir")
    assertEquals(Windows.resolve("c:/", "//server/share"), "\\\\server\\share\\")
    assertEquals(Windows.resolve("c:/", "///some//dir"), "c:\\some\\dir")
    assertEquals(Windows.resolve("C:\\foo\\tmp.3\\", "..\\tmp.3\\cycles\\root.js"), "C:\\foo\\tmp.3\\cycles\\root.js")
    assertEquals(Windows.resolve("foo"), "C:\\foo")
    assertEquals(Windows.resolve("\\foo"), "C:\\foo")
    assertEquals(Windows.resolve("d:foo"), "d:\\foo")
    assertEquals(Windows.resolve(), "C:\\")
  })

  it("relative", () => {
    assertEquals(Windows.relative("c:/blah\\blah", "d:/games"), "d:\\games")
    assertEquals(Windows.relative("c:/aaaa/bbbb", "c:/aaaa"), "..")
    assertEquals(Windows.relative("c:/aaaa/bbbb", "c:/cccc"), "..\\..\\cccc")
    assertEquals(Windows.relative("c:/aaaa/bbbb", "c:/aaaa/bbbb"), "")
    assertEquals(Windows.relative("C:\\foo\\bar\\baz\\quux", "C:\\"), "..\\..\\..\\..")
    assertEquals(Windows.relative("\\\\foo\\bar", "\\\\foo\\bar\\baz"), "baz")
    assertEquals(Windows.relative("a", "a\\b"), "b")
  })

  it("toNamespacedPath", () => {
    assertEquals(Windows.toNamespacedPath("C:\\path\\to\\file.txt"), "\\\\?\\C:\\path\\to\\file.txt")
    assertEquals(Windows.toNamespacedPath("\\\\path\\to\\file.txt"), "\\\\?\\UNC\\path\\to\\file.txt")
    assertEquals(Windows.toNamespacedPath("file.txt"), "\\\\?\\C:\\file.txt")
    assertEquals(Windows.toNamespacedPath(""), "")
  })

  it("common", () => {
    assertEquals(Windows.common(["c:\\deno\\cli\\js\\deno.ts", "c:\\deno\\std\\path\\mod.ts"]), "c:\\deno\\")
    assertEquals(Windows.common(["c:\\deno", "d:\\deno"]), "")
  })

  it.effect("fromFileUrl", () =>
    Effect.gen(function*() {
      assertEquals(yield* Windows.fromFileUrl(new URL("file:///home/foo")), "\\home\\foo")
      assertEquals(yield* Windows.fromFileUrl("file:///C:/Users/"), "C:\\Users\\")
      assertEquals(yield* Windows.fromFileUrl("file://localhost/C:/"), "C:\\")
      assertEquals(yield* Windows.fromFileUrl("file:///C:foo/bar"), "\\C:foo\\bar")
      assertEquals(yield* Windows.fromFileUrl("file://server/share/a"), "\\\\server\\share\\a")
      yield* assertFailsWithTag(Windows.fromFileUrl("http://localhost/foo"), "BadArgument")
    }))

  it.effect("toFileUrl", () =>
    Effect.gen(function*() {
      assertEquals((yield* Windows.toFileUrl("/home/foo")).href, "file:///home/foo")
      assertEquals((yield* Windows.toFileUrl("/home\\foo")).href, "file:///home/foo")
      assertEquals((yield* Windows.toFileUrl("C:/")).href, "file:///C:/")
      assertEquals((yield* Windows.toFileUrl("//localhost/")).href, "file:///")
      assertEquals((yield* Windows.toFileUrl("//127.0.0.1/")).href, "file://127.0.0.1/")
      assertEquals((yield* Windows.toFileUrl("\\\\server\\share\\a b")).href, "file://server/share/a%20b")
      yield* assertFailsWithTag(Windows.toFileUrl("foo"), "BadArgument")
      yield* assertFailsWithTag(Windows.toFileUrl("C:foo"), "BadArgument")
    }))

  it("glob helpers", () => {
    assert(Windows.globToRegExp("*.ts").test("mod.ts"))
    assert(Windows.globToRegExp("**\\*.ts").test("a\\b\\mod.ts"))
    assert(Windows.globToRegExp("**/*.ts").test("a/b/mod.ts"))
    assert(Windows.isGlob("*.ts"))
    assertEquals(Windows.joinGlobs(["foo", "bar", "..", "baz"]), "foo\\baz")
    assertEquals(Windows.normalizeGlob("foo\\bar\\..\\baz"), "foo\\baz")
  })

  it("constants", () => {
    assertEquals(Windows.SEPARATOR, "\\")
    assertEquals(Windows.DELIMITER, ";")
    assertEquals("a\\/b".split(Windows.SEPARATOR_PATTERN), ["a", "b"])
  })
})

describe("layers", () => {
  it.effect("layerPosix provides the Path service", () =>
    Effect.gen(function*() {
      const path = yield* Path.Path
      assertEquals(path.sep, "/")
      assertEquals(path.join("a", "b"), "a/b")
      assertEquals(path.resolve("x"), "/x")
      assertEquals(path.relative("a", "b"), "../b")
      assertEquals((yield* path.toFileUrl("/a b")).href, "file:///a%20b")
      assertEquals(yield* path.fromFileUrl(new URL("file:///a%20b")), "/a b")
      yield* assertFailsWithTag(path.toFileUrl("rel"), "BadArgument")
    }).pipe(Effect.provide(Path.layerPosix)))

  it.effect("layerWindows provides the Path service", () =>
    Effect.gen(function*() {
      const path = yield* EffectPath.Path
      assertEquals(path.sep, "\\")
      assertEquals(path.join("a", "b"), "a\\b")
      assertEquals(path.resolve("x"), "C:\\x")
      assertEquals(path.toNamespacedPath("x"), "\\\\?\\C:\\x")
      assertEquals((yield* path.toFileUrl("C:\\a")).href, "file:///C:/a")
    }).pipe(Effect.provide(Path.layerWindows)))

  it.effect("layerWith sets the working directory", () =>
    Effect.gen(function*() {
      const posix = Posix.make({ cwd: "/app" })
      assertEquals(posix.resolve("src"), "/app/src")
      assertEquals(posix.relative("src", "/app/lib"), "../lib")
      assertEquals(Posix.make({ cwd: "app" }).resolve("x"), "/app/x")
      const windows = Windows.make({ cwd: "D:\\work" })
      assertEquals(windows.resolve("src"), "D:\\work\\src")
      assertEquals(windows.resolve("C:x"), "C:\\x")
      assertEquals(windows.toNamespacedPath("a"), "\\\\?\\D:\\work\\a")
      const path = yield* Path.Path.pipe(Effect.provide(Posix.layerWith({ cwd: "/srv" })))
      assertEquals(path.resolve("www"), "/srv/www")
      const win = yield* Path.Path.pipe(Effect.provide(Windows.layerWith({ cwd: "E:\\" })))
      assertEquals(win.resolve("www"), "E:\\www")
    }))

  it.effect("layer resolves relative paths against /", () =>
    Effect.gen(function*() {
      const path = yield* Path.Path
      assertEquals(path.join("a", "..", "b"), "b")
      assertEquals(path.resolve("a"), "/a")
    }).pipe(Effect.provide(Path.layer)))
})

describe("mod", () => {
  it("exports the POSIX functions", () => {
    assertEquals(Path.join("a", "b", "../c"), "a/c")
    assertEquals(Path.basename("/a/b.ts", ".ts"), "b")
    assertEquals(Path.dirname("/a/b"), "/a")
    assertEquals(Path.extname("b.ts"), ".ts")
    assertEquals(Path.normalize("a//b"), "a/b")
    assertEquals(Path.parse("/a/b").base, "b")
    assertEquals(Path.format({ dir: "/a", base: "b" }), "/a/b")
    assert(Path.isAbsolute("/a"))
    assertEquals(Path.resolve("a"), "/a")
    assertEquals(Path.relative("/a", "/b"), "../b")
    assertEquals(Path.toNamespacedPath("/a"), "/a")
    assertEquals(Path.common(["/a/b", "/a/c"]), "/a/")
    assert(Path.globToRegExp("*.ts").test("a.ts"))
    assert(Path.isGlob("*"))
    assertEquals(Path.joinGlobs(["a", "b"]), "a/b")
    assertEquals(Path.normalizeGlob("a/./b"), "a/b")
    assertEquals(Path.SEPARATOR, "/")
    assertEquals(Path.DELIMITER, ":")
    assertEquals("a/b".split(Path.SEPARATOR_PATTERN), ["a", "b"])
    assertEquals(Path.Windows.SEPARATOR, "\\")
    assertEquals(Path.Posix.SEPARATOR, "/")
  })

  it.effect("exports the file URL effects", () =>
    Effect.gen(function*() {
      assertEquals(yield* Path.fromFileUrl("file:///a"), "/a")
      assertEquals((yield* Path.toFileUrl("/a")).href, "file:///a")
    }))
})
