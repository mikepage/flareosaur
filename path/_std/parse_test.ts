// Copyright 2018-2026 the Deno authors. MIT license.

import { assertEquals } from "../../assert/_std/mod.ts";
import * as windows from "./windows/mod.ts";

Deno.test("windows.parse() parses UNC root only path", () => {
  const parsed = windows.parse("\\\\server\\share");
  assertEquals<unknown>(parsed, {
    base: "\\",
    dir: "\\\\server\\share",
    ext: "",
    name: "",
    root: "\\\\server\\share",
  });
});
