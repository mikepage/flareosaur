// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Effect tests that run inside workerd. See {@linkcode it}.
 *
 * Spies and stubs are in {@linkcode Mock} (`./testing/mock`), test-clock
 * helpers in {@linkcode Time} (`./testing/time`).
 *
 * @module
 */

export * from "./Test.ts"
export * as Mock from "./Mock.ts"
export * as Time from "./Time.ts"
