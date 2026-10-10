// Copyright 2026 the flareosaur authors. MIT license.
// A minimal Deno.test runner for the ported std tests. The test bundler
// rewrites `Deno.test` to `__denoTest`, so test files run unmodified inside
// workerd without a `Deno` global that would change library behaviour.

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const TIMEOUT_MS = 20_000;

const registered = [];

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

// Stand-ins for the Deno file reads that tests use on their own testdata.
export const __denoReadFileSync = (path) => fixture(path);
export const __denoReadTextFileSync = (path) =>
  new TextDecoder().decode(fixture(path));
export const __denoReadFile = async (path) => fixture(path);
export const __denoReadTextFile = async (path) =>
  new TextDecoder().decode(fixture(path));
let currentFile = "";

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

export function __denoTest(a, b, c) {
  registered.push({ ...normalize(a, b, c), file: currentFile });
}
__denoTest.ignore = (a, b, c) =>
  registered.push({ ...normalize(a, b, c), ignore: true, file: currentFile });
__denoTest.only = __denoTest;

function errorText(e) {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 2000);
  return String(e).slice(0, 2000);
}

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

async function runFn(def, parent) {
  const failures = [];
  const ctx = {
    name: def.name,
    origin: def.file,
    parent,
    async step(a, b, c) {
      const sub = normalize(a, b, c);
      if (sub.ignore) return false;
      const err = await runFn(sub, ctx);
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

export async function run(files, trace = false) {
  const results = [];
  for (const [file, load] of Object.entries(files)) {
    currentFile = file;
    const start = registered.length;
    try {
      await load();
    } catch (e) {
      results.push({ file, name: "<load>", status: "fail", error: errorText(e) });
      continue;
    }
    for (const def of registered.slice(start)) {
      if (def.ignore) {
        results.push({ file, name: def.name, status: "ignored" });
        continue;
      }
      let error;
      // deno-lint-ignore no-console
      if (trace) console.log(`[trace] ${file} :: ${def.name}`);
      try {
        error = await withTimeout(runFn(def, undefined));
      } catch (e) {
        error = errorText(e);
      }
      results.push({
        file,
        name: def.name,
        status: error ? "fail" : "pass",
        ...(error ? { error } : {}),
      });
    }
  }
  return results;
}
