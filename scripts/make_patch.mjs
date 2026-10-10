// Copyright 2026 the flareosaur authors. MIT license.
// Regenerates patches/edge.patch: the difference between a fresh, unpatched
// port of the std checkout and the package directories in this repo.
//
//   node scripts/make_patch.mjs [path/to/std]

import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STD = resolve(process.argv[2] ?? join(ROOT, "../std"));
const tmp = mkdtempSync(join(tmpdir(), "flareosaur-patch-"));
const git = (...args) =>
  execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd: tmp,
    maxBuffer: 1 << 30,
  });

try {
  execFileSync(process.execPath, [
    join(ROOT, "scripts/port.mjs"),
    STD,
    "--no-patches",
    "--out",
    tmp,
  ], { stdio: "inherit" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=port", "-c", "user.email=port@localhost", "commit", "-qm", "port");

  const workspace = JSON.parse(readFileSync(join(ROOT, "deno.json"), "utf8"))
    .workspace.map((p) => p.slice(2));
  for (const pkg of workspace) {
    rmSync(join(tmp, pkg), { recursive: true, force: true });
    cpSync(join(ROOT, pkg), join(tmp, pkg), { recursive: true });
  }
  git("add", "-A");
  const patch = git("diff", "--cached", "--binary");
  mkdirSync(join(ROOT, "patches"), { recursive: true });
  writeFileSync(join(ROOT, "patches/edge.patch"), patch);
  const stat = git("diff", "--cached", "--shortstat").toString().trim();
  console.log(`wrote patches/edge.patch (${stat})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
