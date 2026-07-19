# Decision: `patch` as a pet property

Status: shipped (hard rename; `patch-here()` is a targeted compile error).


`patch` is the canonical name for the patch under the current pet.
It replaces `patch-here()`. The `()` was misleading: `patch-here()` was never
a function call in the ordinary sense — it returned a writable reference
backed by the global patch grid, accepted block-update syntax on its left
side, and took no arguments. As a property it sits alongside `x`, `y`,
`heading`, and `id` in the pet's surface.

```pet
termites:
  where (patch.has-chip):
    patch := :
      state: empty
      has-chip: false
    state := carrying
    forward(20)
```

### Rules

1. **Pet context only.** `patch` is available wherever the current
   pet is in scope: a breed update block, an action body, a `match` arm
   inside a pet block. It is not available in `patches:` updates,
   `zones:` updates, `defs:`, monitors, or stop conditions.

2. **Not a first-class value.** `patch` alone is not an expression. It must
   be followed by `.field` or appear as an assignment target. Passing
   `patch` to a function or storing it in a `let` is not supported — this
   keeps the property a context-bound view rather than a reference value.

3. **Reads.** `patch.field` reads a patch field for the patch the pet
   is currently standing on. Topology is applied to the pet's
   continuous coordinates before the patch is resolved.

4. **Writes.** `patch.field := expr` writes a single field.
   `patch := :` followed by an indented field map writes several fields.
   Writes target the global patch grid; multiple pets on the same
   patch writing the same field in the same tick race normally.

5. **Reserved identifier.** No breed, patch, zone, or memory declaration
   may use the name `patch`. The parser rejects such declarations with a
   targeted error.

6. **No effect on `patch-at`.** `patch-at(x, y).field` keeps its current
   form. It is a parameterized lookup, available in any context, and the
   `-at` suffix already reads as "at coordinate."

### Lowering

`patch.field` lowers to the same JavaScript that `patch-here().field`
emits today. `patch` is purely a surface rename plus a context-sensitive
parse rule; no runtime concept changes.

### Coexistence and migration

This is a hard rename, not a coexistence feature. `patch-here()` is
removed from the surface in the same language version that introduces
`patch`. Existing `.pet` files are mechanically rewritten — every
`patch-here()` becomes `patch` — as part of the language version bump.
