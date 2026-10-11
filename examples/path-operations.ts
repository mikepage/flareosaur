/**
 * @title Path operations
 * @difficulty beginner
 * @tags workers, path
 * @group Standard library
 * @resource {https://jsr.io/@std/path} @std/path
 * @check GET / -> 200 "join: /assets/img/logo.png" "basename: logo.png" "extname: .png" "dirname: /assets/img" "relative: ../css/site.css" "glob matches: true, false" "windows: C:\\Users\\ada\\notes.txt"
 *
 * Object keys in R2, routes and asset manifests are all paths, even on a
 * runtime without a filesystem. std's path module has POSIX and Windows
 * implementations as pure functions. Import the POSIX ones directly: on
 * Workers there is no working directory, so relative paths resolve
 * against `/`.
 */

import {
  basename,
  dirname,
  extname,
  globToRegExp,
  join,
  normalize,
  relative,
} from "@mikepage/flareosaur/path/posix";
import { join as windowsJoin } from "@mikepage/flareosaur/path/windows";
import { script } from "./_lib/script.ts";

export default script((print) => {
  // join adds separators and resolves "." and "..".
  print(`join: ${join("/assets", "img", "../img/logo.png")}`);
  print(`basename: ${basename("/assets/img/logo.png")}`);
  print(`extname: ${extname("logo.png")}`);
  print(`dirname: ${dirname("/assets/img/logo.png")}`);
  print(`relative: ${relative("/assets/js", "/assets/css/site.css")}`);

  // normalize cleans up a key before it reaches R2. Leading ".." cannot
  // climb above the root.
  print(`normalized: ${normalize("/uploads/../../etc//passwd")}`);

  // globToRegExp turns a glob into a RegExp, handy for matching keys.
  const images = globToRegExp("assets/**/*.{png,jpg}");
  print(
    `glob matches: ${images.test("assets/img/a.png")}, ${
      images.test("assets/img/a.svg")
    }`,
  );

  // The Windows flavour, for paths that come from Windows clients.
  print(`windows: ${windowsJoin("C:\\Users", "ada", "notes.txt")}`);
});
