// Copyright 2026 the flareosaur authors. MIT license.
// Ports packages from a denoland/std checkout into this repo.
//
//   node scripts/port.mjs [path/to/std] [--no-patches] [--out <dir>]
//
// Steps: copy the selected packages, drop files that need Deno or Node APIs,
// turn crypto's inline wasm into a .wasm module import, and apply
// patches/*.patch for the hand-made edge fixes.
//
// Everything is published as one JSR package. Each std package becomes a
// subpath (`@std/http/cookie` -> `@mikepage/flareosaur/http/cookie`), listed in
// the root deno.json `exports`. Imports between packages become relative
// paths, so the code needs no import map. Doc comments get the new specifiers.
//
// To change the edge fixes, edit the ported files and run
// scripts/make_patch.mjs, which diffs them against a fresh unpatched port.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const OUT = outIndex === -1 ? ROOT : resolve(args[outIndex + 1]);
const positional = args.filter((a, i) =>
  !a.startsWith("--") && (outIndex === -1 || i !== outIndex + 1)
);
const STD = resolve(positional[0] ?? join(ROOT, "../std"));
const NAME = "@mikepage/flareosaur";

// Directory -> files to leave out (paths relative to the package, a trailing
// slash means a directory) or `only` to copy just those files. `dropExports`
// and `addExports` adjust the exports taken from the package's deno.json.
const PACKAGES = {
  assert: {},
  async: {},
  bytes: {},
  cache: {},
  collections: {},
  crypto: {
    exclude: [
      "_wasm/src/",
      "_wasm/.cargo/",
      "_wasm/.rustfmt.toml",
      "_wasm/Cargo.toml",
      "_wasm/Cargo.lock",
      "_wasm/rust-toolchain.toml",
      "_wasm/test.ts",
      "_wasm/README.md",
    ],
  },
  csv: {},
  data_structures: {},
  datetime: {},
  // load.ts and the load*() functions read .env files from disk.
  dotenv: {
    exclude: [
      "load.ts",
      "load_test.ts",
      "mod_test.ts",
      "testdata/app_defaults.ts",
      "testdata/app_load.ts",
      "testdata/app_load_child.ts",
      "testdata/app_load_parent.ts",
    ],
    dropExports: ["./load"],
  },
  encoding: {},
  fmt: {},
  front_matter: {},
  html: {},
  // The file server needs a filesystem.
  http: {
    exclude: [
      "file_server.ts",
      "file_server_test.ts",
      "unstable_file_server.ts",
      "unstable_file_server_test.ts",
      "testdata/desktop.ini",
      "testdata/file_server_as_library.ts",
      "testdata/hello.html",
      "testdata/nested-subdirs/",
      "testdata/subdir-with-index/",
      "testdata/test_clean_urls/",
      "testdata/test_clean_urls.html",
      "testdata/test_empty_file.txt",
      "testdata/test_file.txt",
    ],
    dropExports: ["./file-server", "./unstable-file-server"],
  },
  // inspect.ts is added by patches/edge.patch.
  internal: { addExports: { "./inspect": "./inspect.ts" } },
  json: {},
  // The conformance suites read their fixtures from disk and eval them.
  jsonc: { exclude: ["testdata/"] },
  media_types: { exclude: ["vendor/update.ts"] },
  path: {},
  regexp: {},
  semver: {},
  streams: {},
  // Only the runner-independent parts. bdd and snapshot are built on
  // Deno.test and the filesystem.
  testing: {
    only: [
      "README.md",
      "deno.json",
      "_mock_utils.ts",
      "_test_utils.ts",
      "_time.ts",
      "mock.ts",
      "mock_test.ts",
      "time.ts",
      "time_test.ts",
      "types.ts",
      "types_test.ts",
      "unstable_stub.ts",
      "unstable_stub_test.ts",
      "unstable_stub_property.ts",
      "unstable_stub_property_test.ts",
      "unstable_types.ts",
      "unstable_types_test.ts",
    ],
    dropExports: [
      "./bdd",
      "./snapshot",
      "./unstable-bdd",
      "./unstable-snapshot",
    ],
  },
  text: {},
  toml: {},
  ulid: {},
  uuid: {},
  yaml: {},
};

const TEXT = /\.(ts|mts|mjs|js|md)$/;

function skip(rel, opts) {
  if (rel === "deno.json") return true;
  if (opts.only) return !opts.only.includes(rel);
  if (/(^|\/)(_benches?|_tools)\//.test(rel) || /_bench\.ts$/.test(rel)) {
    return true;
  }
  return (opts.exclude ?? []).some((e) =>
    e.endsWith("/") ? rel.startsWith(e) : rel === e
  );
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const posix = (p) => p.split(sep).join("/");

// `@std/<name>[/<sub>]` -> { subpath in the new package, file in OUT }.
function collectExports() {
  const specifiers = new Map();
  const exports = {};
  for (const [dir, opts] of Object.entries(PACKAGES)) {
    const config = JSON.parse(
      readFileSync(join(STD, dir, "deno.json"), "utf8"),
    );
    const name = config.name.replace(/^@std\//, "");
    const entries = typeof config.exports === "string"
      ? { ".": config.exports }
      : { ...config.exports };
    for (const key of opts.dropExports ?? []) delete entries[key];
    Object.assign(entries, opts.addExports);
    for (const [sub, file] of Object.entries(entries)) {
      const subpath = sub === "." ? name : `${name}/${sub.slice(2)}`;
      const target = `./${dir}/${file.slice(2)}`;
      exports[`./${subpath}`] = target;
      specifiers.set(`@std/${subpath}`, join(OUT, target));
    }
  }
  return { specifiers, exports };
}

// Code imports of @std/* become relative paths. Everything else (doc
// comments, markdown, strings in tests) gets the new package name.
function rewrite(src, dest, specifiers, isCode) {
  return src.split("\n").map((line) => {
    const trimmed = line.trimStart();
    const comment = trimmed.startsWith("*") || trimmed.startsWith("//") ||
      trimmed.startsWith("/*");
    if (isCode && !comment) {
      line = line.replace(/(["'])(@std\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)?)\1/g, (m, q, spec) => {
        const target = specifiers.get(spec);
        if (!target) return m;
        let rel = posix(relative(dirname(dest), target));
        if (!rel.startsWith(".")) rel = `./${rel}`;
        return `${q}${rel}${q}`;
      });
    }
    return line.replaceAll("jsr:@std/", `jsr:${NAME}/`)
      .replace(/(^|[\s"'`(])@std\/(?=[a-z])/g, `$1${NAME}/`);
  }).join("\n");
}

function portPackage(dir, opts, specifiers) {
  const from = join(STD, dir);
  const to = join(OUT, dir);
  rmSync(to, { recursive: true, force: true });
  for (const file of walk(from)) {
    const rel = relative(from, file);
    if (skip(posix(rel), opts)) continue;
    const dest = join(to, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (TEXT.test(file)) {
      const isCode = !file.endsWith(".md");
      writeFileSync(
        dest,
        rewrite(readFileSync(file, "utf8"), dest, specifiers, isCode),
      );
    } else {
      cpSync(file, dest);
    }
  }
}

// workerd refuses to compile wasm from bytes at runtime, so the inline base64
// blob becomes a .wasm file imported as a WebAssembly.Module.
function externalizeWasm() {
  const lib = join(OUT, "crypto/_wasm/lib");
  const loaderPath = join(lib, "deno_std_wasm_crypto.mjs");
  const loader = readFileSync(loaderPath, "utf8");
  const match = loader.match(/base64decode\("\\\n([\s\S]*?)"\);/);
  if (!match) throw new Error("crypto: inline wasm not found");
  const bytes = Buffer.from(match[1].replaceAll("\\\n", ""), "base64");
  writeFileSync(join(lib, "deno_std_wasm_crypto.wasm"), bytes);
  writeFileSync(
    loaderPath,
    `// @generated by scripts/port.mjs from the wasmbuild output -- do not edit
// @ts-nocheck: generated
// deno-lint-ignore-file
// deno-fmt-ignore-file
// @ts-self-types="./deno_std_wasm_crypto.d.mts"

import * as imports from "./deno_std_wasm_crypto.internal.mjs";
import wasmModule from "./deno_std_wasm_crypto.wasm";
const wasm = new WebAssembly.Instance(wasmModule, {
  "./deno_std_wasm_crypto.internal.mjs": imports,
});

export * from "./deno_std_wasm_crypto.internal.mjs";
import { __wbg_set_wasm } from "./deno_std_wasm_crypto.internal.mjs";
__wbg_set_wasm(wasm.exports);
wasm.exports.__wbindgen_start();
`,
  );
}

function writeExports(exports) {
  const path = join(OUT, "deno.json");
  if (!existsSync(path)) return;
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.exports = exports;
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

if (!existsSync(join(STD, "deno.json"))) {
  console.error(`No std checkout at ${STD}`);
  process.exit(1);
}
const { specifiers, exports } = collectExports();
for (const [dir, opts] of Object.entries(PACKAGES)) {
  portPackage(dir, opts, specifiers);
}
externalizeWasm();
writeExports(exports);

const patches = join(ROOT, "patches");
if (existsSync(patches) && !args.includes("--no-patches")) {
  const files = readdirSync(patches).filter((f) => f.endsWith(".patch"));
  for (const p of files.sort()) {
    execFileSync("git", ["apply", "--whitespace=nowarn", join(patches, p)], {
      cwd: OUT,
      stdio: "inherit",
    });
    console.log(`applied ${p}`);
  }
}
const rev = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: STD })
  .toString().trim();
writeFileSync(join(OUT, "UPSTREAM"), `denoland/std@${rev}\n`);
console.log(`ported ${Object.keys(PACKAGES).length} packages from std@${rev}`);
