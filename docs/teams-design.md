# Teams: compile-time stamping for symmetric factions

## Problem

Multi-faction models today duplicate everything per faction. `ant-queens` is
335 lines; ~70% is the same block stamped three times (crimson/azure/gold):
three identical player breeds, three identical ant breeds, three copies of the
setup, three copies of every turn block, three copies of each monitor. Only
the agent personas genuinely differ.

## Design

Teams are a **compile-time expansion** (a source-to-source preprocessor that
runs before the existing parse/emit pipeline). No engine changes, no runtime
cost, and everything downstream — stylesheets, presets, the Table-talk agent
panel, `agent <breed>:` sections — keeps working because the stamped breeds
(`crimson-ants`, `azure-queens`, …) are real breeds after expansion.

### Declaring teams

```pets
teams:
  crimson:
    home-x: -13
    home-y: -9
  azure:
    home-x: 13
    home-y: -9
  gold:
    home-x: 0
    home-y: 10
```

Each team is a name plus optional numeric **team constants**. Constants cover
asymmetry: since `create ants colony-size` accepts any expression, a
`colony-size` constant per team gives teams different numbers (and a count of
0 effectively removes a type from one team) — "players of various types and
numbers" without extra syntax.

### Teamed breeds

A breed declared `per team` is a template, stamped once per team as
`<team>-<name>`:

```pets
pets:
  player queens per team:
    rally-x: number = home-x     # team constants usable in defaults
    rally-y: number = home-y
    posture: bold | wary = wary

  ants per team:
    eaten: number = 0
```

→ `crimson-queens`, `azure-queens`, `gold-queens`, `crimson-ants`, …

### Stamping — no new block syntax

Any `create` statement or breed-update block that names a template is stamped
once per team, with three substitutions applied through its whole body:

1. template breed names → that team's stamped breed (`queens` → `crimson-queens`)
2. team constants → that team's value (`home-x` → `-13`)
3. `enemy <template>` → the other teams' stamped breeds (see below)

```pets
setup:
  create queens 1
  queens:
    set-position(home-x, home-y)

  create ants ants-per-colony
  ants:
    scatter 4 from one-of queens
    heading := random(360)

turn 8:
  queens:
    decide rally-x, rally-y, posture
```

### Enemy references

`enemy <template>` means "every other team's copy". v1 supports it where a
union has a natural expansion:

| Context                            | Expansion                                          |
| ---------------------------------- | -------------------------------------------------- |
| `count-in-radius(enemy ants, r)`   | `(count-in-radius(azure-ants, r) + count-in-radius(gold-ants, r))` |
| `count enemy ants where (...)`     | sum of per-team counts                             |
| `any enemy ants where (...)`       | `or` of per-team any                               |
| a statement block containing `enemy ants` (e.g. `let prey = one-of enemy ants here` + its uses) | the block is stamped once per enemy team, `let` locals suffixed by team name |

Anything else (`nearest enemy ants`, `one-of enemy ants`) is a compile
diagnostic in v1 — cross-team unions need engine agentset support, which is
future work.

### Per-team monitors

```pets
monitors:
  harvest per team: number = sum ants report (eaten)
  alive per team: number = count ants
```

→ `crimson-harvest`, `azure-harvest`, `gold-harvest`, `crimson-alive`, …

### Agent personas stay per team

Stamped breeds are real breeds, so the existing syntax already works — the
one part of a faction model that *should* be written three times stays
hand-written:

```pets
agent crimson-queens:
  system:
    You are General Vex...
```

(A `agent queens for crimson:` sugar can come later; it buys nothing yet.)

### Diagnostics

- Referencing a template breed outside a stamping context (a non-`per team`
  monitor, a patch block, a stop condition) → "X is a per-team breed; use it
  inside a breed block, `enemy X`, or a `per team` monitor."
- `enemy X` where X is not a per-team breed, or outside a stamped block → error.
- Team constants shadowing params → error.

## Result on ant-queens

335 lines → ~165, and adding a fourth team becomes a 5-line diff (one team
entry + one agent persona) instead of ~80 lines of stamped blocks.

## v1 scope & future work

- v1: uniform breed templates across teams; asymmetric counts via team
  constants; `enemy` in count/any/kill-one contexts.
- Future: per-team rosters with distinct breed types, `nearest enemy ...`
  (engine union agentsets), a `team` builtin for labels/styling, `agent X for
  <team>:` persona sugar, team-indexed stylesheet colors.
