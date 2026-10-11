// Copyright 2018-2026 the Deno authors. MIT license.
import { assertEquals } from "../../assert/_std/mod.ts";
import * as windows from "./windows/mod.ts";
import * as posix from "./posix/mod.ts";

Deno.test("windows.joinGlobs() joins the glob patterns", function () {
  assertEquals(
    windows.joinGlobs(["foo", "*", "bar"]),
    `foo\\*\\bar`,
  );
  assertEquals(
    windows.joinGlobs([""], { globstar: true }),
    ".",
  );
  assertEquals(
    windows.joinGlobs(["**", ".."], { globstar: true }),
    `**\\..`,
  );
});

Deno.test("windows.joinGlobs() joins the glob patterns", function () {
  assertEquals(
    posix.joinGlobs(["foo", "*", "bar"]),
    `foo/*/bar`,
  );
  assertEquals(
    posix.joinGlobs([""], { globstar: true }),
    ".",
  );
  assertEquals(
    posix.joinGlobs(["**", ".."], { globstar: true }),
    `**/..`,
  );
});
