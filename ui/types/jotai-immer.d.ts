declare module "jotai/immer" {
  import type { WritableAtom } from "jotai";
  /**
   * Minimal type declaration for atomWithImmer used in this project.
   * This returns an Atom whose value is of the provided type and which
   * supports Immer-style setters when used with Jotai.
   */
  export function atomWithImmer<Value = unknown>(
    initialValue: Value,
  ): WritableAtom<Value, any, any>;
  export function atomWithImmer<Value = unknown>(
    getter: () => Value,
  ): WritableAtom<Value, any, any>;
}
