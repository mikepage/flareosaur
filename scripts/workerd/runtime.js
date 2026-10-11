// Copyright 2026 the flareosaur authors. MIT license.
// The test runtime inside workerd. Two kinds of tests register here:
//
// - Effect tests, through `describe` / `it.effect` from the testing package,
//   which push entries onto the shared registry below
// - std's own tests in `_std/`, written against `Deno.test`. The bundler
//   rewrites `Deno.test` to `__denoTest`, so they run unmodified without a
//   `Deno` global that would change library behaviour.
//
// Each entry is `{ name, skip, run }`, where `run()` resolves to an error
// message or null.

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const TIMEOUT_MS = 20_000;

const REGISTRY = Symbol.for("flareosaur/testing/registry");
const registry = (globalThis[REGISTRY] ??= []);

// Test fixtures, embedded by the bundler: absolute path -> base64 contents.
let fixtures = {};
export function setFixtures(map) {
  fixtures = map;
}

function fixture(path) {
  const href = path instanceof URL ? path.href : String(path);
  const key = href.startsWith("file:")
    ? decodeURIComponent(new URL(href).pathname)
    : href;
  const data = fixtures[key];
  if (data === undefined) throw new Error(`No such fixture: ${key}`);
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

// Stand-ins for the Deno file reads that std tests use on their own testdata.
export const __denoReadFileSync = (path) => fixture(path);
export const __denoReadTextFileSync = (path) =>
  new TextDecoder().decode(fixture(path));
export const __denoReadFile = async (path) => fixture(path);
export const __denoReadTextFile = async (path) =>
  new TextDecoder().decode(fixture(path));

function errorText(e) {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 4000);
  return String(e).slice(0, 4000);
}

function normalize(a, b, c) {
  if (typeof a === "function") return { name: a.name, fn: a };
  if (typeof a === "string") {
    return typeof b === "function"
      ? { name: a, fn: b }
      : { ...b, name: a, fn: c };
  }
  if (typeof b === "function") return { ...a, name: a.name ?? b.name, fn: b };
  return { ...a };
}

async function runDenoTest(def, parent) {
  const failures = [];
  const ctx = {
    name: def.name,
    parent,
    async step(a, b, c) {
      const sub = normalize(a, b, c);
      if (sub.ignore) return false;
      const err = await runDenoTest(sub, ctx);
      if (err) failures.push(`${sub.name} > ${err}`);
      return !err;
    },
  };
  try {
    await def.fn(ctx);
  } catch (e) {
    return errorText(e);
  }
  return failures.length ? failures.join("\n") : null;
}

export function __denoTest(a, b, c) {
  const def = normalize(a, b, c);
  registry.push({
    name: def.name,
    skip: Boolean(def.ignore),
    run: () => runDenoTest(def, undefined),
  });
}
__denoTest.ignore = (a, b, c) => __denoTest({ ...normalize(a, b, c), ignore: true });
__denoTest.only = __denoTest;

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = realSetTimeout(
        () => reject(new Error(`timed out after ${TIMEOUT_MS}ms`)),
        TIMEOUT_MS,
      );
    }),
  ]).finally(() => realClearTimeout(timer));
}

export async function run(files, trace = false) {
  const results = [];
  for (const [file, load] of Object.entries(files)) {
    const start = registry.length;
    try {
      await load();
    } catch (e) {
      results.push({ file, name: "<load>", status: "fail", error: errorText(e) });
      continue;
    }
    for (const entry of registry.slice(start)) {
      if (entry.skip) {
        results.push({ file, name: entry.name, status: "ignored" });
        continue;
      }
      // deno-lint-ignore no-console
      if (trace) console.log(`[trace] ${file} :: ${entry.name}`);
      let error;
      try {
        error = await withTimeout(entry.run());
      } catch (e) {
        error = errorText(e);
      }
      results.push({
        file,
        name: entry.name,
        status: error ? "fail" : "pass",
        ...(error ? { error } : {}),
      });
    }
  }
  return results;
}
