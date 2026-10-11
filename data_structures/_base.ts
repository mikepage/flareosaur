// Copyright 2026 the flareosaur authors. MIT license.
// The base of the data structures: pipeable, and inspectable through toJSON.

import { Inspectable, Option, Pipeable } from "effect"

/** A pipeable, inspectable structure; subclasses describe themselves in `toJSON`. */
export abstract class Structure extends Pipeable.Class implements Inspectable.Inspectable {
  abstract toJSON(): unknown

  override toString(): string {
    return Inspectable.toStringUnknown(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }
}

/** `undefined` as `None`, for std methods that return `undefined` when empty. */
export const fromUndefined = <A>(value: A | undefined): Option.Option<A> =>
  value === undefined ? Option.none() : Option.some(value)

/** `null` as `None`, for std methods that return `null` when missing. */
export const fromNull = <A>(value: A | null): Option.Option<A> => value === null ? Option.none() : Option.some(value)
