// Copyright 2026 the flareosaur authors. MIT license.
// This module is browser compatible.

/**
 * A runtime-independent stand-in for `Deno.inspect`, used where neither
 * `Deno.inspect` nor `node:util` exists (Cloudflare Workers without
 * nodejs_compat, browsers). It follows the layout rules of Deno's console
 * (which come from Node's `util.inspect`): `depth`, numeric and boolean
 * `compact`, `breakLength`, `sorted`, `trailingComma`, `getters`,
 * `iterableLimit` and `strAbbreviateSize`. It never colors, and does not
 * group long arrays into columns.
 *
 * @module
 */

/** Options for {@linkcode inspect}, a subset of `Deno.InspectOptions`. */
export interface InspectOptions {
  /** Nesting depth to expand. Deeper objects print as `[Object]`. */
  depth?: number;
  /**
   * `false` puts every entry on its own line. A number joins the innermost
   * levels onto one line when they fit in `breakLength`. `true` joins
   * whatever fits.
   */
  compact?: boolean | number;
  /** Line width used by `compact`. */
  breakLength?: number;
  /** Sort object keys and Map/Set entries. */
  sorted?: boolean;
  /** Add a comma after the last entry of a multi-line object. */
  trailingComma?: boolean;
  /** Call getters and show their values. */
  getters?: boolean;
  /** Maximum number of array, Map or Set entries to show. */
  iterableLimit?: number;
  /** Maximum length of a nested string before it is abbreviated. */
  strAbbreviateSize?: number;
}

const DEFAULTS: Required<InspectOptions> = {
  depth: 4,
  compact: 3,
  breakLength: 80,
  sorted: false,
  trailingComma: false,
  getters: false,
  iterableLimit: 100,
  strAbbreviateSize: 100,
};

const IDENT = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
const QUOTES = ['"', "'", "`"];
const CUSTOM_INSPECT = Symbol.for("Deno.customInspect");

const ESCAPES: Record<string, string> = {
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\v": "\\v",
};

interface Ctx extends Required<InspectOptions> {
  seen: object[];
  circular: Map<object, number>;
  currentDepth: number;
  indentationLvl: number;
}

/** Quotes a string the way Deno does: the first quote it does not contain. */
export function quoteString(str: string): string {
  const quote = QUOTES.find((q) => !str.includes(q)) ?? QUOTES[0]!;
  const escaped = str
    .replace(new RegExp(`(?=[${quote}\\\\])`, "g"), "\\")
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x1f\x7f-\x9f]/g, (c) =>
      ESCAPES[c] ??
        `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `${quote}${escaped}${quote}`;
}

function formatString(str: string, ctx: Ctx, nested: boolean): string {
  if (nested && str.length > ctx.strAbbreviateSize) {
    const rest = str.length - ctx.strAbbreviateSize;
    return `${
      quoteString(str.slice(0, ctx.strAbbreviateSize))
    }... ${rest} more character${rest > 1 ? "s" : ""}`;
  }
  return quoteString(str);
}

function formatKey(key: string | symbol): string {
  if (typeof key === "symbol") return `[${String(key)}]`;
  if (key === "__proto__") return "['__proto__']";
  return IDENT.test(key) ? key : quoteString(key);
}

// deno-lint-ignore ban-types
function functionBase(fn: Function): string {
  const source = Function.prototype.toString.call(fn);
  if (source.startsWith("class")) {
    const parent = Object.getPrototypeOf(fn);
    const base = fn.name ? `class ${fn.name}` : "class (anonymous)";
    return parent && parent !== Function.prototype && parent.name
      ? `[${base} extends ${parent.name}]`
      : `[${base}]`;
  }
  const kind = toStringTag(fn);
  return fn.name ? `[${kind}: ${fn.name}]` : `[${kind} (anonymous)]`;
}

function constructorName(obj: object): string | null {
  let proto = Object.getPrototypeOf(obj);
  while (proto) {
    const ctor = Object.getOwnPropertyDescriptor(proto, "constructor")?.value;
    if (typeof ctor === "function" && ctor.name) return ctor.name;
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

function indentLines(text: string): string {
  return text.replaceAll("\n", "\n  ");
}

function isBelowBreakLength(
  ctx: Ctx,
  output: string[],
  start: number,
  base: string,
): boolean {
  let total = output.length + start;
  if (total + output.length > ctx.breakLength) return false;
  for (const entry of output) {
    total += entry.length;
    if (total > ctx.breakLength) return false;
  }
  return base === "" || !base.includes("\n");
}

// Joins formatted entries into one object literal, like Node's
// reduceToSingleString().
function reduce(
  ctx: Ctx,
  output: string[],
  base: string,
  braces: [string, string],
  level: number,
): string {
  const head = base ? `${base} ` : "";
  if (ctx.compact !== true) {
    if (
      typeof ctx.compact === "number" && ctx.compact >= 1 &&
      ctx.currentDepth - level < ctx.compact
    ) {
      const start = output.length + ctx.indentationLvl + braces[0].length +
        base.length + 10;
      if (isBelowBreakLength(ctx, output, start, base)) {
        const joined = output.join(", ");
        if (!joined.includes("\n")) {
          return `${head}${braces[0]} ${joined} ${braces[1]}`;
        }
      }
    }
    const comma = ctx.trailingComma ? "," : "";
    return `${head}${braces[0]}\n  ${
      output.map(indentLines).join(",\n  ")
    }${comma}\n${braces[1]}`;
  }
  if (isBelowBreakLength(ctx, output, 0, base)) {
    return `${braces[0]}${base ? ` ${base}` : ""} ${output.join(", ")} ${
      braces[1]
    }`;
  }
  const ln = base === "" && braces[0].length === 1
    ? " "
    : `${base ? ` ${base}` : ""}\n  `;
  return `${braces[0]}${ln}${output.map(indentLines).join(",\n  ")} ${
    braces[1]
  }`;
}

function formatValue(
  value: unknown,
  ctx: Ctx,
  level: number,
  nested: boolean,
): string {
  switch (typeof value) {
    case "string":
      return formatString(value, ctx, nested);
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "bigint":
      return `${value}n`;
    case "boolean":
      return String(value);
    case "undefined":
      return "undefined";
    case "symbol":
      return String(value);
  }
  if (value === null) return "null";
  const obj = value as object;

  // deno-lint-ignore no-explicit-any
  const custom = (obj as any)[CUSTOM_INSPECT];
  if (typeof custom === "function") {
    const options = { ...pickOptions(ctx), depth: ctx.depth - level };
    return String(custom.call(
      obj,
      (v: unknown, o?: InspectOptions) => inspect(v, { ...options, ...o }),
      options,
    ));
  }

  if (ctx.seen.includes(obj)) {
    let id = ctx.circular.get(obj);
    if (id === undefined) {
      id = ctx.circular.size + 1;
      ctx.circular.set(obj, id);
    }
    return `[Circular *${id}]`;
  }

  ctx.seen.push(obj);
  try {
    const body = formatRaw(obj, ctx, level);
    const id = ctx.circular.get(obj);
    return id === undefined ? body : `<ref *${id}> ${body}`;
  } finally {
    ctx.seen.pop();
  }
}

function pickOptions(ctx: Ctx): Required<InspectOptions> {
  const { seen: _s, circular: _c, currentDepth: _d, indentationLvl: _i, ...o } =
    ctx;
  return o;
}

function formatProperty(
  obj: object,
  key: string | symbol,
  ctx: Ctx,
  level: number,
): string {
  const desc = Object.getOwnPropertyDescriptor(obj, key)!;
  let shown: string;
  ctx.indentationLvl += 2;
  if (desc.get || desc.set) {
    const label = desc.get && desc.set
      ? "Getter/Setter"
      : desc.get
      ? "Getter"
      : "Setter";
    if (desc.get && ctx.getters) {
      try {
        shown = `[${label}: ${
          formatValue(desc.get.call(obj), ctx, level + 1, true)
        }]`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        shown = `[${label}: <Inspection threw (${msg})>]`;
      }
    } else {
      shown = `[${label}]`;
    }
  } else {
    shown = formatValue(desc.value, ctx, level + 1, true);
  }
  ctx.indentationLvl -= 2;
  return `${formatKey(key)}: ${shown}`;
}

function ownKeys(obj: object, skip: (key: string) => boolean = () => false) {
  return [
    ...Object.keys(obj).filter((k) => !skip(k)),
    ...Object.getOwnPropertySymbols(obj).filter((s) =>
      Object.prototype.propertyIsEnumerable.call(obj, s)
    ),
  ];
}

// Platform objects such as URL or Headers keep their state behind prototype
// accessors and would print as `URL {}`. WebIDL attributes are enumerable
// accessors (JS class accessors are not), so list those instead.
function platformAttributes(obj: object, ctx: Ctx, level: number): string[] {
  const entries: string[] = [];
  let proto = Object.getPrototypeOf(obj);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.keys(proto)) {
      const get = Object.getOwnPropertyDescriptor(proto, key)?.get;
      if (!get) continue;
      try {
        const v = get.call(obj);
        if (typeof v === "function") continue;
        ctx.indentationLvl += 2;
        entries.push(
          `${formatKey(key)}: ${formatValue(v, ctx, level + 1, true)}`,
        );
        ctx.indentationLvl -= 2;
      } catch { /* not readable on this object */ }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return entries;
}

function formatList(
  values: Iterable<unknown>,
  size: number,
  ctx: Ctx,
  format: (v: unknown) => string,
): string[] {
  const output: string[] = [];
  ctx.indentationLvl += 2;
  for (const v of values) {
    if (output.length === ctx.iterableLimit) break;
    output.push(format(v));
  }
  ctx.indentationLvl -= 2;
  const rest = size - output.length;
  if (rest > 0) output.push(`... ${rest} more item${rest > 1 ? "s" : ""}`);
  return output;
}

function toStringTag(obj: object): string {
  try {
    return Object.prototype.toString.call(obj).slice(8, -1);
  } catch {
    return "Object";
  }
}

function formatRaw(obj: object, ctx: Ctx, level: number): string {
  const tag = toStringTag(obj);
  const name = constructorName(obj);
  let base = "";
  let braces: [string, string] = ["{", "}"];
  let output: string[];
  let keys: (string | symbol)[];
  let sortWhole = true;

  if (typeof obj === "function") {
    base = functionBase(obj);
    keys = ownKeys(obj);
    if (keys.length === 0) return base;
    output = [];
  } else if (Array.isArray(obj)) {
    keys = ownKeys(obj, (k) => /^\d+$/.test(k));
    const prefix = name && name !== "Array" ? `${name}(${obj.length}) ` : "";
    braces = [`${prefix}[`, "]"];
    if (obj.length === 0 && keys.length === 0) return `${braces[0]}]`;
    if (level > ctx.depth) return `[${name ?? "Array"}]`;
    ctx.currentDepth = level;
    output = [];
    ctx.indentationLvl += 2;
    let holes = 0;
    const flush = () => {
      if (holes) output.push(`<${holes} empty item${holes > 1 ? "s" : ""}>`);
      holes = 0;
    };
    let shown = 0;
    for (let i = 0; i < obj.length && shown < ctx.iterableLimit; i++) {
      if (!Object.hasOwn(obj, i)) {
        holes++;
        continue;
      }
      flush();
      output.push(formatValue(obj[i], ctx, level + 1, true));
      shown = i + 1;
    }
    flush();
    ctx.indentationLvl -= 2;
    const rest = obj.length - Math.max(shown, output.length);
    if (shown >= ctx.iterableLimit && rest > 0) {
      output.push(`... ${rest} more item${rest > 1 ? "s" : ""}`);
    }
    sortWhole = false;
  } else if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
    // deno-lint-ignore no-explicit-any
    const arr = obj as any as ArrayLike<number | bigint>;
    keys = [];
    braces = [`${name ?? tag}(${arr.length}) [`, "]"];
    if (arr.length === 0) return `${braces[0]}]`;
    if (level > ctx.depth) return `[${name ?? tag}]`;
    output = formatList(
      Array.from(arr),
      arr.length,
      ctx,
      (v) => formatValue(v, ctx, level + 1, true),
    );
    sortWhole = false;
  } else if (obj instanceof Map) {
    keys = ownKeys(obj);
    braces = [`${name ?? "Map"}(${obj.size}) {`, "}"];
    if (obj.size === 0 && keys.length === 0) return `${braces[0]}}`;
    if (level > ctx.depth) return `[${name ?? "Map"}]`;
    ctx.currentDepth = level;
    output = formatList(obj, obj.size, ctx, (e) => {
      const [k, v] = e as [unknown, unknown];
      return `${formatValue(k, ctx, level + 1, true)} => ${
        formatValue(v, ctx, level + 1, true)
      }`;
    });
  } else if (obj instanceof Set) {
    keys = ownKeys(obj);
    braces = [`${name ?? "Set"}(${obj.size}) {`, "}"];
    if (obj.size === 0 && keys.length === 0) return `${braces[0]}}`;
    if (level > ctx.depth) return `[${name ?? "Set"}]`;
    ctx.currentDepth = level;
    output = formatList(
      obj,
      obj.size,
      ctx,
      (v) => formatValue(v, ctx, level + 1, true),
    );
  } else if (obj instanceof Date) {
    const time = obj.getTime();
    base = Number.isNaN(time) ? "Invalid Date" : obj.toISOString();
    keys = ownKeys(obj);
    if (keys.length === 0) return base;
    output = [];
  } else if (obj instanceof RegExp) {
    base = String(obj);
    keys = ownKeys(obj, (k) => k === "lastIndex");
    if (keys.length === 0) return base;
    output = [];
  } else if (obj instanceof Error) {
    base = obj.stack ?? `${obj.name}: ${obj.message}`;
    keys = ownKeys(obj, (k) => k === "stack");
    output = [];
    if (obj.cause !== undefined && !Object.keys(obj).includes("cause")) {
      ctx.indentationLvl += 2;
      output.push(`[cause]: ${formatValue(obj.cause, ctx, level + 1, true)}`);
      ctx.indentationLvl -= 2;
    }
    if (keys.length === 0 && output.length === 0) return base;
  } else if (obj instanceof WeakMap || obj instanceof WeakSet) {
    return `${name ?? tag} { <items unknown> }`;
  } else if (obj instanceof Promise) {
    return `${name ?? "Promise"} { <unknown> }`;
  } else if (
    obj instanceof Number || obj instanceof String ||
    obj instanceof Boolean || obj instanceof BigInt ||
    obj instanceof Symbol
  ) {
    base = `[${tag}: ${formatValue(obj.valueOf(), ctx, level, false)}]`;
    keys = ownKeys(obj, (k) => obj instanceof String && /^\d+$/.test(k));
    if (keys.length === 0) return base;
    output = [];
  } else if (obj instanceof ArrayBuffer) {
    const bytes = [...new Uint8Array(obj)].map((b) =>
      b.toString(16).padStart(2, "0")
    );
    return reduce(
      ctx,
      [
        `[Uint8Contents]: <${bytes.join(" ")}>`,
        `byteLength: ${obj.byteLength}`,
      ],
      "",
      ["ArrayBuffer {", "}"],
      level,
    );
  } else {
    keys = ownKeys(obj);
    let prefix: string;
    if (Object.getPrototypeOf(obj) === null) {
      prefix = "[Object: null prototype] ";
    } else if (name === "Object" || name === null) {
      prefix = tag !== "Object" ? `Object [${tag}] ` : "";
    } else {
      prefix = tag !== "Object" && tag !== name
        ? `${name} [${tag}] `
        : `${name} `;
    }
    braces = [`${prefix}{`, "}"];
    output = [];
    if (keys.length === 0) {
      if (level > ctx.depth) return `${braces[0]}}`;
      const attributes = platformAttributes(obj, ctx, level);
      if (attributes.length === 0) return `${braces[0]}}`;
      ctx.currentDepth = level;
      return reduce(ctx, attributes, base, braces, level);
    }
  }

  if (level > ctx.depth) {
    return base || `[${name ?? "Object"}]`;
  }
  ctx.currentDepth = level;
  const props = keys.map((k) => formatProperty(obj, k, ctx, level));
  if (ctx.sorted) {
    if (sortWhole) {
      output = [...output, ...props].sort();
    } else {
      output = [...output, ...props.sort()];
    }
  } else {
    output = [...output, ...props];
  }
  return reduce(ctx, output, base, braces, level);
}

/**
 * Formats a value like `Deno.inspect()`, without colors.
 *
 * @param value The value to format.
 * @param options Formatting options. Defaults match `Deno.inspect()`.
 * @returns The formatted string.
 */
export function inspect(value: unknown, options: InspectOptions = {}): string {
  const ctx: Ctx = {
    ...DEFAULTS,
    ...options,
    seen: [],
    circular: new Map(),
    currentDepth: 0,
    indentationLvl: 0,
  };
  return formatValue(value, ctx, 0, false);
}
