# Decision: paren-less zero-argument commands

Status: shipped (hard removal; the old paren forms are targeted compile
errors). The rule: **parens iff the call has arguments** — it applies to
builtin commands, user actions, and link endpoint reporters (`end1`, `end2`,
`link-neighbors`) alike.


Zero-argument commands lose their parentheses to match the existing
convention for actions. Today, user-defined actions and builtin
zero-arg commands diverge:

- User actions: `wiggle`, `jump-away`, `random-move` — no parens
- Builtin zero-arg commands: `die()`, `set-random-position()` — parens

A reader has no way to tell from a call site whether a name needs parens.
The principled rule is: **parens iff the call has arguments.**

### Affected names

| Today                    | After                  |
| ------------------------ | ---------------------- |
| `die()`                  | `die`                  |
| `set-random-position()`  | `set-random-position`  |

Commands that take arguments are unaffected: `forward(1)`, `turn(180)`,
`face(target)`, `set-position(x, y)`, `move-to(target)`,
`turn-towards(target, max)`, `turn-away(target, max)`, `hatch(breed)`,
`kill-one(breed, energy, gain)`, `follow-patch-gradient(field, ...)`,
`diffuse(field, rate)`.

### Why not also drop parens from `hatch(sheep)` when called with one arg?

Single-arg invocations keep parens because the parens cement the
command-with-argument shape: `hatch(sheep)` reads as "hatch this breed"
with `sheep` as a clear object. Without parens, `hatch sheep` conflicts
visually with keyword-style reporters like `nearest sheep` and
`count sheep where (...)`. Parens around args make the call site
unambiguous.

### Coexistence and migration

Same model as the `patch` rename: hard removal of the paren form,
mechanical rewrite of existing `.pet` files in the version bump.
