// Copyright 2026 the flareosaur authors. MIT license.
// The std packages this repo can vendor into `<dir>/_std/`, and which of
// their files to leave out. A package is vendored when its `_std` directory
// exists, or when vendored code of another package imports it.

export interface StdPackage {
  /** Files to leave out, relative to the package; a trailing slash is a directory. */
  readonly exclude?: ReadonlyArray<string>
  /** Copy only these files. */
  readonly only?: ReadonlyArray<string>
}

export const STD_PACKAGES: Readonly<Record<string, StdPackage>> = {
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
  },
  internal: {},
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
  },
  text: {},
  toml: {},
  ulid: {},
  uuid: {},
  yaml: {},
}

/** Packages of this repo that do not come from std. */
export const OWN_PACKAGES: ReadonlyArray<string> = ["workers"]

/** Every package directory: the std ones and this repo's own. */
export const ALL_PACKAGES: ReadonlyArray<string> = [...Object.keys(STD_PACKAGES), ...OWN_PACKAGES].sort()

/** Directory name -> JSR subpath segment, e.g. data_structures -> data-structures. */
export const kebab = (dir: string): string => dir.replaceAll("_", "-")
