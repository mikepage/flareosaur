// Copyright 2026 the flareosaur authors. MIT license.
// Runs each package's tests inside workerd with no compatibility flags.
//
//   node scripts/test.mjs [package...] [--verbose]
//
// Per package: bundle every *_test.ts (plus every public export, imported
// statically so global-scope violations surface) with esbuild, load it into
// Miniflare and call fetch() to run the tests. Tests listed in
// scripts/skip.json need Deno APIs (filesystem, subprocesses, env) and are
// reported as skipped.

import { build } from "esbuild";
import { Miniflare } from "miniflare";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "node_modules/.flareosaur-test");
const COMPAT_DATE = "2026-07-30";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const workspace = JSON.parse(readFileSync(join(ROOT, "deno.json"), "utf8"))
  .workspace.map((p) => p.slice(2));
// "pkg" runs a package, "pkg/file_test.ts" a single file of it.
const targets = args.filter((a) => !a.startsWith("--"));
const selected = targets.length
  ? [...new Set(targets.map((t) => t.split("/")[0]))]
  : workspace;
const fileFilter = (pkg, file) =>
  !targets.some((t) => t.startsWith(`${pkg}/`)) ||
  targets.includes(`${pkg}/${file}`);
const skips = JSON.parse(readFileSync(join(ROOT, "scripts/skip.json"), "utf8"));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "testdata" || name === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const posix = (p) => p.split("\\").join("/");

function isSkipped(pkg, file, name) {
  const list = skips[`${pkg}/${file}`];
  return list === "*" || (Array.isArray(list) && list.includes(name));
}

// A few tests import node: built-ins to compare against Node. workerd has none
// without nodejs_compat, so they resolve to stubs that throw when used.
const nodeStubs = {
  name: "node-stubs",
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (a) => ({ path: a.path, namespace: "node-stub" }));
    b.onLoad({ filter: /.*/, namespace: "node-stub" }, (a) => ({
      contents: `const stub = new Proxy(function () {}, {
  get(_, key) {
    if (key === "__esModule" || key === Symbol.toPrimitive) return undefined;
    throw new Error("${a.path} is not available in workerd: " + String(key));
  },
  apply() { throw new Error("${a.path} is not available in workerd"); },
});
export default stub;
export const { inspect, isMainThread, Worker, cwd, platform } = new Proxy({}, { get: () => stub });`,
      loader: "js",
    }));
  },
};

async function bundle(pkg) {
  const dir = join(ROOT, pkg);
  const out = join(OUT, pkg);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const tests = walk(dir)
    .filter((f) => /(^|[_/])test\.ts$/.test(posix(relative(dir, f))))
    .filter((f) => fileFilter(pkg, posix(relative(dir, f))))
    .sort();
  const { exports } = JSON.parse(readFileSync(join(dir, "deno.json"), "utf8"));
  const entries = Object.values(
    typeof exports === "string" ? { ".": exports } : exports,
  );
  const rel = (f) => JSON.stringify(posix(relative(out, f)));
  const entry = [
    `import { run } from ${rel(join(ROOT, "scripts/test_shim.js"))};`,
    ...entries.map((e, i) =>
      `import * as _export${i} from ${rel(join(dir, e))};`
    ),
    `const files = {`,
    ...tests.map((f) =>
      `  ${JSON.stringify(posix(relative(dir, f)))}: () => import(${rel(f)}),`
    ),
    `};`,
    `export default {`,
    `  async fetch(request) {`,
    `    const file = new URL(request.url).searchParams.get("file");`,
    `    if (!file) return Response.json(Object.keys(files));`,
    `    return Response.json(await run({ [file]: files[file] }));`,
    `  },`,
    `};`,
  ].join("\n");
  const entryPath = join(out, "entry.js");
  writeFileSync(entryPath, entry);

  await build({
    entryPoints: [entryPath],
    outdir: join(out, "dist"),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "neutral",
    target: "esnext",
    conditions: ["workerd", "worker", "browser"],
    tsconfig: join(ROOT, "tsconfig.json"),
    loader: { ".wasm": "copy" },
    define: { "Deno.test": "__denoTest" },
    inject: [join(ROOT, "scripts/test_shim.js")],
    plugins: [nodeStubs],
    keepNames: true,
    logLevel: "silent",
  });

  const dist = join(out, "dist");
  return readdirSync(dist).map((name) => ({
    type: name.endsWith(".wasm") ? "CompiledWasm" : "ESModule",
    path: join(dist, name),
    contents: readFileSync(join(dist, name)),
  })).sort((a, b) => (a.path.endsWith("entry.js") ? -1 : b.path.endsWith("entry.js") ? 1 : 0));
}

function newWorker(pkg, modules) {
  return new Miniflare({
    modules,
    modulesRoot: join(OUT, pkg, "dist"),
    compatibilityDate: COMPAT_DATE,
    compatibilityFlags: [],
  });
}

async function runPackage(pkg) {
  let modules;
  try {
    modules = await bundle(pkg);
  } catch (e) {
    return [{ file: "<bundle>", name: "<bundle>", status: "fail", error: e.message }];
  }
  let mf = newWorker(pkg, modules);
  const results = [];
  try {
    const files = await (await mf.dispatchFetch("http://localhost/")).json();
    for (const file of files) {
      try {
        const url = `http://localhost/?file=${encodeURIComponent(file)}`;
        const res = await mf.dispatchFetch(url);
        const text = await res.text();
        if (!res.ok) throw new Error(text.slice(0, 2000));
        results.push(...JSON.parse(text));
      } catch (e) {
        results.push({ file, name: "<worker>", status: "fail", error: e.message });
        // The isolate may be gone; start a fresh one for the next file.
        await mf.dispose().catch(() => {});
        mf = newWorker(pkg, modules);
      }
    }
  } catch (e) {
    results.push({ file: "<worker>", name: "<worker>", status: "fail", error: e.message });
  } finally {
    await mf.dispose().catch(() => {});
  }
  return results;
}

const totals = { pass: 0, fail: 0, ignored: 0, skipped: 0 };
const failures = [];
for (const pkg of selected) {
  const results = await runPackage(pkg);
  const count = { pass: 0, fail: 0, ignored: 0, skipped: 0 };
  for (const r of results) {
    if (r.status === "fail" && isSkipped(pkg, r.file, r.name)) r.status = "skipped";
    count[r.status]++;
    totals[r.status]++;
    if (r.status === "fail") failures.push({ pkg, ...r });
  }
  const mark = count.fail ? "FAIL" : "ok  ";
  console.log(
    `${mark} ${pkg.padEnd(16)} ${count.pass} passed, ${count.fail} failed, ${count.skipped} skipped, ${count.ignored} ignored`,
  );
}

if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) {
    const err = verbose ? f.error : f.error?.split("\n")[0].slice(0, 200);
    console.log(`  ${f.pkg}/${f.file} :: ${f.name}\n    ${err}`);
  }
}
console.log(
  `\n${totals.pass} passed, ${totals.fail} failed, ${totals.skipped} skipped, ${totals.ignored} ignored`,
);
process.exit(totals.fail ? 1 : 0);
