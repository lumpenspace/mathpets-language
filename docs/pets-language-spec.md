# MathPets Language Guide And Current Spec

This document is the current truth for the MathPets source language. MathPets is the
only user-facing model source language in the Studio. JavaScript is the compiler
target and runtime implementation detail.

Runnable examples live at:

```text
packages/examples/src/models/<model-id>/
  index.ts
  source.pet     # authored MathPets source for real ports
  styles.petstyle
  presets.petpreset
  reference.ts    # previous TypeScript implementation for comparison
```

Every model in the catalog (32 at the time of writing) is authored this way;
`yarn check:examples` compiles them all and `yarn check:runtime` runs each
for 25 ticks.

## MathPets Source Files

MathPets files use the `.pet` extension. They are the authored source of truth
for ported models, and `yarn generate:pets-parser` compiles the grammar into TypeScript
modules consumed by the Studio.

A `.pet` file starts with a MathPets metadata block:

```pets
model:
  name: WolframAutomaton
```

The compiler lifts `model.name` into the MathPets model declaration. The MathPets body
then starts directly with sections such as `defs:`, `world:`, `params:`,
`patches:`, `setup:`, and `step:`.

Declaration sections may appear in any order before the lifecycle tail. This
includes `defs:`, `world:`, `params:`, `memory:`, `monitors:`, `patches:`,
`zones:`, `pets:`, and `links:`. The lifecycle sections stay ordered: `setup:` first, one or more
`step:` sections after setup, then the optional `brush:` section, and the
optional `stop when (...)` end condition last.

Presentation lives outside `source.pet`. Example styles are authored in
`styles.petstyle`; presets are authored in `presets.petpreset`. Keeping these
sidecars separate leaves the core language suitable for headless and future
non-JavaScript compilers.

## Variables

MathPets has several variable-like surfaces. They differ by ownership and lifetime.

`params:` are editable model parameters. They are shown in the UI and can be
changed by the user.

```pets
params:
  density: number = slider(62, 0..100)
  feed: number = slider(0.06, 0.005..0.09, step 0.001)
  show-grid: boolean = toggle(true)
  seed-mode: single | random = select(single)
```

`monitors:` are readonly values derived from model state. They appear in the
inspector but cannot be edited.

```pets
monitors:
  living-trees: number = count patches where tree
```

Patch fields are owned by each patch. Every patch receives the declared initial
value during model construction.

```pets
patches:
  state: empty | tree | burning | burned = empty
  protected: boolean = false
  heat: number = 0
```

Link fields are owned by each link. Links are declared as directed or
undirected breeds and can be queried, styled, and updated like other agentsets.

```pets
links:
  link contacts undirected:
    state: calm | exposed = calm
    weight: number = 1
```

Zones are named square aggregate grids over patches. A zone behaves like an
agentset member with its own fields, plus a `patches-in` query that returns the
patches contained by the current zone. The `size` number is the side length of
each square in patches.

```pets
zones:
  zone clusters size 4:
    live-count: number = 0
    state: growth | stable | cool = stable

step:
  clusters:
    live-count := count patches-in where (living)
    state := if (live-count >= 6) then growth else stable

  patches:
    cluster-state := zone-at(clusters).state
```

`let` variables exist inside function blocks and agent update blocks. They are
local and immutable. In an agent block, a `let` is recomputed for each current
agent.

```pets
defs:
  weighted(left: boolean, center: boolean, right: boolean): number:
    let pattern: number = bit(left) * 4 + bit(center) * 2 + bit(right)
    pattern

step:
  flockers:
    let flockmates = flockers in-radius vision
    flockmate-count := count flockmates
```

`memory:` values are model-owned mutable scalars. They are not patch fields and
they are not user controls; they are useful for lifecycle bookkeeping such as
the row Wolfram Automaton is currently writing.

```pets
memory:
  source-row: number = max-y
  generated-rows: number = 0
```

## World

A MathPets model runs in a finite rectangular grid of integer-coordinate
patches. The `world:` block declares the grid bounds and the topology that
governs every coordinate-resolving reporter.

```pets
world:
  x: -25..25
  y: -18..18
  topology: box
```

### Bounds and coordinates

`x: a..b` and `y: a..b` are inclusive on both ends. `x: -25..25` is a 51-patch
span; `x: -24..23` is a 48-patch span. Widths and heights may be even or odd,
and the origin `(0, 0)` is a real patch only when the range crosses zero.

`min-x`, `max-x`, `min-y`, and `max-y` resolve to the literal bounds and are
available in every expression context.

Inside a patch update, `px` and `py` are the current patch's integer
coordinates. Inside a pet update, `x` and `y` are the pet's continuous
(real-valued) position; the `patch` property resolves to the patch
containing `(x, y)` after applying topology.

### Topology

`topology:` controls how every coordinate-resolving reporter behaves at the
world boundary. Supported values:

| Topology | x edges | y edges |
| -------- | ------- | ------- |
| `box`    | hard    | hard    |
| `torus`  | wrap    | wrap    |
| `wrap-x` | wrap    | hard    |
| `wrap-y` | hard    | wrap    |

Topology applies to `patch-at(x, y)`, `pet-at(breed, x, y)`,
`neighbor-at(direction)`, `neighbors-at(...)`, `neighbors4`/`neighbors8`,
`in-radius` and `in-square` patch regions, `nearest`, `distance-to`, `face`,
`follow-patch-gradient`, and pet motion (`forward`, `turn-towards`,
`turn-away`).

On a **wrap** axis, out-of-range coordinates are normalized modulo the axis
width (`max - min + 1`). Distance, heading, and radius reporters use the
shortest topological path; radius queries can span the seam.

On a **hard** axis:

- `patch-at(x, y)` with an out-of-range coordinate returns nothing.
  Dereferencing `.field` on the missing patch will fail at runtime, so guard
  the lookup with coordinate bounds. Turing Diffusion shows the canonical
  pattern:

  ```pets
  defs:
    sample-u(col: number, row: number, fallback: number): number:
      if (col < min-x or col > max-x or row < min-y or row > max-y)
        then fallback
        else patch-at(col, row).u
  ```

- `neighbors4`, `neighbors8`, and `neighbors-at(...)` at a corner or edge
  return an agentset with **fewer entries** rather than placeholder patches.
  `count neighbors8` at a corner of a `box` world is 3, not 8.

- Pet motion commands clamp the new position to the world edge.
  `forward(20)` near the right edge stops the pet at the edge instead of
  wrapping or moving off-world.

### Heading and motion conventions

Headings are NetLogo-compatible: `heading` is degrees in `[0, 360)`, `0`
points north (+y), `90` east, and positive angles turn **clockwise**.
`turn(degrees)` adds clockwise degrees; `turn(-10)` turns counter-clockwise.
`forward(distance)` moves along the heading in world units — `forward(1)` is
one tile. Movement samples the path in steps of at most `0.5` units (walls
are respected per sample; see [Walls](#walls)), and `sin`/`cos`/`tan` take
radians, not headings.

### Patch coordinates vs pet coordinates

Patches own integer `px`/`py`. Pets own continuous `x`/`y` (floats), plus
`id` (integer index) and `heading` (degrees in `[0, 360)`). These names do not
overlap across patch and pet contexts; reading the wrong one in the wrong
context is a compile-time error.

```pets
patches:
  where (px = min-x):
    state := burning

flockers:
  where (x > 0):
    turn(45)
    forward(1)
```

## States

The field named `state` is special: enum values declared on it register as
visual states for the board, and state names can be used directly as
predicates:

```pets
patches:
  state: dead | alive = dead

patches where alive:
  state := dead
```

`state` may instead be numeric; numeric state registers no discrete visual
states and is meant for continuous color scales in the stylesheet (see
[Sidecars](#sidecars)). Because style rules can target any declared field,
`state` is never required — a model whose visuals hang off boolean or
numeric fields needs no `state` at all.

## Lifecycle

Compilation is:

```text
MathPets source
  -> Lezer parser generated from pets.grammar
  -> MathPets AST
  -> JavaScript emitter
  -> createModel()
  -> ModelDefinition
```

Runtime execution is:

```text
world.setup()
world.step()
world.endCondition?()
model.getSnapshot()
CanvasBoard render
```

`setup:` initializes the world.

```pets
setup:
  patches:
    state := if (random-float(100) < density) then tree else empty
```

Every model has an implicit random seed shown in the Studio inspector. By
default, setup chooses a fresh seed for each run. The advanced seed control can
pin a fixed seed when an exact replay is needed. In compiled MathPets code,
`random-float(...)`, `random(...)`, and `random-int(...)` are keyed by the seed,
the current tick, the current patch/pet index when one exists, and the source
call site. That makes setup and step behavior repeatable for the same model
source, params, pinned seed, and engine version.

`step:` advances the world by one authored simulation transition. A model may
declare multiple `step` sections. They run sequentially inside one call to
`world.step()`, and the UI tick increments once after the full sequence.

A staged step makes matching updates see the previous state of that phase before
committing their drafts. Later `step` sections read the committed result of
earlier sections.

```pets
step staged:
  patches:
    where burning:
      state := burned

    where (tree and any neighbors4 where burning):
      state := burning

step staged:
  patches:
    u := clamp(u + diffuse-u * laplace-u(px, py, u), 0, 1)
    v := clamp(v + diffuse-v * laplace-v(px, py, v), 0, 1)
```

`stop when (...)` declares the end condition.

```pets
stop when (count patches where burning = 0)
```

## Patches

Patch updates use direct `patches` statements in both `setup:` and `step:`.
Inside `step staged:`, all matching patch updates in that step read the previous
state of the phase before committing their drafts.

```pets
setup:
  patches:
    where (px = min-x):
      state := burning

step staged:
  patches:
    where burning:
      state := burned
```

Agent updates can use an indented block when the same agentset and predicate
should run several actions:

```pets
patches:
  where (tree and py > 0):
    heat := heat + 1
    state := burning
```

Use `target := :` when several fields on the same object should be updated
together:

```pets
sheep:
  where (patch.has-grass):
    patch := :
      has-grass: false
      state: bare
      countdown: grass-regrowth-time
```

Inside an agent block, nested `where` blocks branch per current agent.
`otherwise:` attaches to the previous sibling `where:` block.

```pets
patches:
  let live-neighbors = count neighbors8 where alive

  where alive:
    where (live-neighbors in [2, 3]):
      state := alive
    otherwise:
      state := dead

  otherwise:
    where (live-neighbors = 3):
      state := alive
```

Agent update headers always open a block. Put the colon at the end of the
header, then put one statement per indented line. General `where` conditions use
parentheses.

```pets
patches where (tree and py > 0):
  state := burning
```

using the same center and radius.

Inside any agent update block (pet, patch, or zone context), `patches in-radius r` and `patches in-square r` with no `around (...)` clause center on the current agent's coordinates. In observer contexts (like setup, step, monitors, or stop conditions) that lack a current agent, the explicit `around (cx, cy)` remains required.


```pets
patches in-radius 5 around (0.6 * max-x, 0):
  food-source-number := 1

patches in-square 3 around (0, 0):
  nest := true
```

State names in predicate contexts lower to `state = state-name`.

```pets
patches where alive:
  state := dead

patches where (alive and count neighbors8 where alive in [2, 3]):
  state := alive

count patches where burning
any neighbors4 where burning
```

Set literals use square brackets. The `in` operator checks membership.

```pets
count neighbors8 where alive in [2, 3]
rule in [30, 90, 110]
```

Neighborhood reporters are available from the current patch context:

```pets
count neighbors4 where burning
count neighbors8 where alive
any neighbors4 where burning
count neighbors-at(top-left, top, top-right) where live
neighbor-at(top).state = live
```

Use `where` for the state or predicate and `around` for the neighboring patch
surface. The `around (...)` clause is always explicit here: without it,
`count cells where alive` is the breed-wide count, in every context. (Only
`in-radius`/`in-square` regions default to the current agent's position —
they had no around-less meaning to collide with.)

```pets
count patches where fertile around (x, y)
count cells where alive around (x, y)
sum patches where food-source around (0, 0) report (food)
```

Patch-wide counts are available in monitors and stop conditions:

```pets
count patches
count patches where alive
mean patches report (u)
sum patches report (food)
```

Coordinate patch lookup uses `patch-at(x, y).field`. The lookup applies the
world topology before reading the field.

```pets
patch-at(px - 1, source-row).state = live
```

Directed patch lookup uses `neighbor-at(direction).field` for one relative
neighbor and `neighbors-at(direction, ...)` for an ordered neighbor query. The
canonical direction symbols are `top-left`, `top`, `top-right`, `left`,
`right`, `bottom-left`, `bottom`, and `bottom-right`; underscores are accepted
as aliases in source expressions.

```pets
neighbor-at(top-left).state = live
count neighbors-at(top-left, top, top-right) where live
```

### Walls

Every patch carries a built-in boolean `wall` field, default `false`. Like
`px`/`py` it is always available without being declared in `patches:` — but
unlike them it is writable. Declaring `wall` in `patches:` is an error.

```pets
setup:
  patches where (px = 0 and py > -5):
    wall := true

step:
  patches where (not wall):
    food := food + regrowth

brush:
  wall := not wall
```

Wall semantics:

- **Movement is blocked.** `forward(distance)` samples the movement path in
  steps of at most 0.5 world units (including the final point), applying the
  world topology per sample. If a sample lands on a patch with `wall = true`,
  the pet stops at the last unblocked sample — it never enters the wall,
  and it does not move at all when even the smallest step is blocked.
  `can-move(distance)` reports `false` when the path is blocked.
- **`move-to` and `set-position` are exempt.** They remain explicit teleports
  and place the pet wherever the target is, walls included. Use `forward`
  (or gate the target with `where (not wall)`) when walls must be respected.
- **Diffusion is isolated.** `diffuse(field, rate)` treats wall patches as
  inert: they neither donate (their field value stays put) nor receive, and
  donors keep the share that would have gone to wall neighbors. A closed wall
  line keeps the far side at exactly zero.
- **Diffusion over a link graph.** `diffuse(field, rate) over <link-breed>`
  diffuses a numeric *pet* field across the link graph instead of the patch
  grid — the same mass-conserving two-phase spread, but each pet's share is
  split among its link-neighbors (directed breeds flow along out-links;
  undirected breeds split across all neighbors). Isolated pets keep their
  value; only pets carrying the numeric field participate. This is spreading
  activation on a network (e.g. rumour salience concentrating on high-in-degree
  tellers). Like patch `diffuse`, it is a bulk statement — write it at the top
  level of a `step`/`round` section, not inside a per-pet block.
- **Gradient following avoids walls.** `follow-patch-gradient(field, ...)`
  excludes wall patches as candidate directions, so pets do not turn
  toward (or try to walk into) walls.

Hosts can stamp wall layouts onto a built model from JavaScript:

- `model.applyWallMap(rows, options?)` sets `wall = true` on patches matching
  `#` characters in `rows`. Rows are listed top-to-bottom (the first row is
  the highest `py`); the map is centered on the world unless
  `options.centerX`/`options.centerY` are given, and cells outside the world
  are clipped. Other characters leave patches untouched.
- `model.clearWalls()` resets `wall` to `false` everywhere.

Both emit a world change so views re-render. Studio presets use these to carry
wall layouts.

## Brush

`brush:` is an optional top-level section that describes what happens when the
user paints a single patch (for example by clicking the board). The body reuses
the patch-block statement forms — assignments, `let`, `where`/`otherwise`,
`match`, and `repeat` — but runs against exactly one patch: the patch that was
clicked. Agent commands such as `forward` and action calls are not allowed.

```pets
params:
  brush-mode: draw | erase = select(draw)

brush:
  match brush-mode:
    draw:
      wall := true
    erase:
      wall := false
```

The brush body can read params and the clicked patch's fields (including the
built-in `wall`, `px`, and `py`). `brush:` appears after the `step:` sections
(before `stop when (...)`), though it is also accepted among the declaration
sections.

Compiled models expose the brush as part of the model definition:

- `model.hasBrush` — `true` when the source declares a `brush:` section.
- `model.applyBrush(px, py)` — resolves the patch at `(px, py)` with the usual
  topology-aware lookup, runs the brush statements against it, and emits a
  world change so the UI updates immediately. It is `undefined` when the model
  has no brush section.

`applyBrush` runs between ticks. Random reporters inside the brush use the same
keyed randomness as `setup:`/`step:` (seed, tick, patch, call site), so
brushing never disturbs the deterministic random sequence of the running
simulation.

## Pets

Pets are the moving agents, backed by the runtime breed system. The current
syntax supports grid-based pets and moving pet models.

Breeds are declared by their name alone inside the `pets:` block. The
explicit `pet <name>:` form is also accepted when the declaration benefits from
being spelled out. Everything inside `pets:` is either an `actions:` block or a
breed declaration.

A breed may instead be declared `player <name>:`. A **player** is a pet
whose decisions arrive through the host application in a round-based model.
Players are ordinary pets in every other respect
(position, heading, movement, queries); the difference is that only player
breeds may `decide` fields and carry the round-protocol state. See
[Round-based models](#round-based-models).

```pets
pets:
  cells:
    state: dead | alive = dead

setup:
  create cells ((max-x - min-x + 1) * (max-y - min-y + 1))
  cells:
    x := min-x + floor(id / (max-y - min-y + 1))
    y := min-y + (id % (max-y - min-y + 1))
```

Creation can also be written as a counted spawn block. The header gives the
count and breed, the first line must be `spawn`, and the remaining lines run as
the initializer for each new pet.

```pets
setup:
  initial-population traders:
    spawn
    set-random-position
    energy := initial-energy + floor(random(initial-energy))
```

Breed names can be used as agentsets in setup, step, monitors, and stop
conditions:

```pets
monitors:
  living-cells: number = count cells where alive

step staged:
  cells:
    let live-neighbors = count cells where alive around (x, y)
    state := dead

    where alive:
      where (live-neighbors in [2, 3]):
        state := alive

    otherwise:
      where (live-neighbors = 3):
        state := alive
```

`pet-at(breed, x, y)` looks up one pet in a breed by the patch at the supplied coordinates. The lookup is truthy if a pet was found and falsy otherwise. Reading a field like `pet-at(breed, x, y).field` through a missing pet throws a runtime error. The coordinate lookup applies world topology first, so torus worlds wrap as expected.

```pets
where (pet-at(cells, x - 1, y + 1)):
  let s = pet-at(cells, x - 1, y + 1).state
```

Moving pet models can issue commands from agent updates:

```pets
step:
  termites:
    where wandering:
      forward(1)
      turn(floor(random(50)))

    where carrying:
      face(nearest patches where chip, 50)
      forward(1)
```

Shared pet actions are the class-level definitions for mutating behavior.
Declare them under `pets: actions:` when every breed may call them.
Breed-local actions live inside a breed block and are only callable from
that breed's update. Actions expand inside the current pet; they do not return
values (which is the role of `defs`), but they may declare typed parameters.

```pets
pets:
  actions:
    random-move:
      turn(floor(random(50)))
      turn(-floor(random(50)))
      forward(1)

  sheep:
    energy: number = 0
    actions:
      eat-grass:
        energy := energy + sheep-gain-from-food
        patch := :
          has-grass: false
          countdown: grass-regrowth-time

  wolves:
    energy: number = 0

step:
  wolves:
    random-move

  sheep:
    random-move

    where (patch.has-grass):
      eat-grass
```

Moving pet models can also save nearby agentsets in per-agent locals. A
breed query followed by `in-radius` excludes the current pet and returns the
nearby pets from that breed.

```pets
step:
  flockers:
    let flockmates = flockers in-radius vision
    flockmate-count := count flockmates

    where (flockmate-count > 0):
      let nearest-flockmate = nearest flockmates
      let nearest-distance = distance-to(nearest-flockmate)

      where (nearest-distance < minimum-separation):
        turn-away(nearest-flockmate, max-separate-turn)

      otherwise:
        turn-towards(average-heading(flockmates), max-align-turn)
        turn-towards(average-heading-towards(flockmates), max-cohere-turn)

    forward(1)
```

Ranked agentset reporters pick a random candidate among the best-scoring
members. `max-one-of` and `min-one-of` take a query and a `report (...)`
expression evaluated from each candidate's context.

```pets
traders:
  let target = max-one-of patches in-radius vision around (x, y) report (sugar)
  move-to(target)
```

### Asker context (`mine`)

Inside `report (...)` expressions and the predicates of nested agentset queries (such as `where (...)`), identifiers rebind to the candidate agent's context. To refer back to the asking agent (the agent that owns the enclosing update block), use `mine.<field>` (e.g. `mine.x`, `mine.y`, `mine.id`):

```pets
couriers:
  let target = min-one-of patches where (state = house-waiting) report (squared-distance(px, py, mine.x, mine.y))
  let claim = one-of patches where (claimed-by = mine)
```

The `mine` keyword can only access declared patch or breed fields, and built-ins (`x`, `y`, `px`, `py`, `id`, `heading`) of the asking agent. `mine` is read-only and cannot be assigned to.

Random subset queries can select a specified number of random agents from a larger set:

```pets
let flock = 5 random sheep
let targets = 3 random patches where (state = house-waiting)
let allies = 2 random other people
```
This picks up to `n` distinct random members from the target agentset (using keyed randomness). The filter is applied before sampling.


### Agent references (`nobody`, `self`, `here`, `kill`)

Fields may hold a reference to another agent. The type is a breed name
("one of the couriers") or `patch`, and the only allowed default is
`nobody`, the missing-agent value:

```pets
patches:
  claimed-by: couriers = nobody

pets:
  couriers:
    target: patch = nobody
```

- Ref fields are truthy/falsy in predicates (`where (claimed-by)`,
  `where (not target)`) and compare with `=` against other refs, `self`,
  `mine`, and `nobody`.
- Reading `.field` through a ref works like the `patch` property
  (`claimed-by.energy`, `target.px`); reading through `nobody` is a runtime
  error, the same rule as `pet-at` on an empty patch.
- `self` is the current agent as a value: `target.claimed-by := self`.
  Inside nested queries the candidate is the current agent and `mine` is the
  asker, so `where (claimed-by = mine)` finds the patches this courier
  claimed.
- A reference to a pet that has died reads as `nobody` — ids are never
  reused, so a stale ref cannot resurrect onto a new agent.
- Refs serialize as ids in snapshots.

`<breed> here` filters a breed to the current agent's patch and composes
with the query surface: `count sheep here`, `any wolves here`,
`one-of sheep here`, `sheep here where (energy > 5)`.

`kill(ref)` removes the referenced pet immediately; killing `nobody` is a
runtime error, so guard with the ref's truthiness. Together these dissolve
the old bespoke commands (`count-here`, `kill-one`):

```pets
wolves:
  where (any sheep here):
    let prey = one-of sheep here
    where (prey):
      kill(prey)
      energy := energy + wolf-gain-from-food
```

In teams models, a statement block containing `enemy <breed>` outside the
supported expression forms is stamped once per enemy team, with `let` locals
suffixed by the team name (see [Teams](#teams)).

`scatter spread` places the pet uniformly inside a square of side `spread`
centered on its current position. `scatter spread from <agent>` centers the
square on another agent (or patch), and `scatter spread from <x>, <y>` on an
explicit point; the final position goes through the same topology
normalization as `set-position`. It replaces the manual idiom
`set-position(cx + random-float(s) - s / 2, cy + random-float(s) - s / 2)`:

```pets
create ants ants-per-colony
ants:
  scatter 4 from one-of queens
```

`turn(degrees)` rotates relative to the current heading. `face(object)` points
at an object, and `face(object, percent)` turns only partway toward it. Percent
is `0..100`, so `face(nearest termites, 25)` turns one quarter of the shortest
angle toward the nearest other termite.

`follow-patch-gradient(field)` samples the patch field ahead, ahead-right, and
ahead-left of the current pet, turns toward the strongest uphill side, and
wiggles when neither side is better. Patches with the built-in `wall` flag set
are excluded as candidates, so the gradient never points into a wall. Optional
min/max bounds gate the current patch value before following:

```pets
ants:
  where searching:
    follow-patch-gradient(chemical, 0.05, 2)

  where carrying:
    follow-patch-gradient(nest-scent)
```

Patch-under-pet access uses `patch`:

```pets
termites:
  where (patch.has-chip):
    patch := :
      state: empty
      has-chip: false
```

Current pet gaps:

- fully general patch radius-query syntax
- action return values

## Links

Links are first-class agents connecting pets. A link breed is declared in
`links:` and may be `undirected` or `directed`; undirected is the default if the
direction is omitted.

```pets
links:
  link contacts undirected:
    state: calm | exposed = calm

setup:
  repeat 3:
    people:
      where (random-float(100) < link-chance):
        let partner = one-of other people
        create-link-with(contacts, partner)
```

`repeat n:` runs an indented setup, step, or agent-action block `n` times.
It is useful for compact stochastic construction passes without copy-pasting
the same agentset block.

Additionally, `repeat <ident> in <a>..<b>:` runs the block over an inclusive integer range from `a` to `b` (both floored to integers). The iteration variable `<ident>` is available as an immutable local binding within the body of the loop. If `a > b`, the block runs zero times.


Link breeds can be used as agentsets:

```pets
monitors:
  contact-count: number = count contacts

step:
  contacts:
    state := calm
    where (end1.state = infected or end2.state = infected):
      state := exposed
```

Inside a pet update, `link-neighbors(link-breed)` reports the adjacent
pets connected by that link breed. `links-with(link-breed)` reports the
incident links themselves.

```pets
people:
  let neighbors = link-neighbors(contacts)
  let infected-neighbor-count = count neighbors where infected
```

For **directed** link breeds, four more reporters split those results by
direction: `in-links(link-breed)` / `out-links(link-breed)` report the incident
links whose head / tail is this pet, and `in-link-neighbors(link-breed)` /
`out-link-neighbors(link-breed)` report the pets on the other end of those
links. `create-link-to(breed, target)` makes a directed link from the current
pet (`end1`) to `target` (`end2`), so the target's `in-links` are exactly the
pets that linked to it. On an *undirected* breed every incident link counts in
both directions, so the `in-`/`out-` forms coincide with `links-with` /
`link-neighbors`. A common use is conferred status as in-degree:

```pets
nodes:
  prestige := count in-links(defers)
```

### Link decay

A link breed may declare `decay <ticks>` after its direction. Links of a
decaying breed age: each link lives `decay` ticks, counting the tick it was
created, then dies. Re-creating an existing link (same breed and endpoints)
refreshes it, restarting the count — so a decayed edge persists only while
the relationship keeps being renewed. In round models ticks advance once per
round, so decay counts rounds.

```pets
links:
  link defers directed decay 6:
    state: quoting = quoting
```

With conferred-status graphs this makes prestige rentable rather than owned:
`count in-links(defers)` reports only endorsements from the last six rounds.

## Defs

`defs:` contains global model-local value functions. A function returns a value
and can be called inside expressions.

```pets
defs:
  bit(value: boolean): number:
    if (value) then 1 else 0

  wolfram-cell(rule: number, left: boolean, center: boolean, right: boolean): boolean:
    let pattern: number = bit(left) * 4 + bit(center) * 2 + bit(right)
    floor(rule / pow(2, pattern)) % 2 = 1
```

Current `defs:` rules:

- the final expression is returned implicitly; explicit `return` still works.
- `let` bindings are local and immutable.
- function bodies may contain `let` bindings and a final returned expression.
- defs can call other defs.
- defs compile to local functions in the generated model factory.
- defs are global; they are not nested under `pets:` or individual breeds.
- defs should not mutate world state.

Mutating reusable behavior belongs in pet `actions:` blocks instead of
`defs:`. Think of `actions:` as class-level or breed-level definitions for behavior:
they are agent-block macros for commands and assignments, while defs are value
functions for expressions.

## `match` arms

`match` dispatches on one or more enum-valued or boolean-valued discriminators,
replacing nested `where ... otherwise:` cascades with a flat table. It is
purely syntactic sugar — `match` lowers to the existing cascade form and adds
no runtime concept.

### Single discriminator

```pets
termites:
  match state:
    wandering:
      wiggle
    carrying | dropping:
      forward(1)
    leaving:
      where (patch.has-chip):
        jump-away
      otherwise:
        state := wandering
```

### Multiple discriminators

```pets
termites:
  match state, patch.has-chip:
    wandering, true:
      patch := :
        state: empty
        has-chip: false
      state := carrying
      forward(20)

    wandering, false:
      wiggle

    carrying, true:
      state := dropping

    carrying, false:
      wiggle

    dropping, false:
      patch := :
        state: chip
        has-chip: true
      state := leaving
      jump-away

    dropping, true:
      turn(floor(random(360)))
      forward(1)

    leaving, true:
      jump-away

    leaving, false:
      state := wandering
```

### Rules

1. **Discriminators.** The `match` header is one or more comma-separated
   discriminator expressions. Each must resolve to either an enum type or
   `boolean`. Numeric and string discriminators are out of scope for this
   proposal.

2. **Arm headers** are tuple patterns. With N discriminators, every arm has
   exactly N positions, separated by commas. Each position is one of:
   - an enum literal — matches that value
   - `true` / `false` — matches that boolean value
   - `_` — wildcard, matches any value of that position's type
   - `lit1 | lit2 | lit3` — alternation over literals from the same type

3. **`otherwise:`** is the default arm, equivalent to an arm with `_` in every
   position.

4. **Exhaustiveness.** The compiler checks coverage over the cartesian product
   of discriminator types. If every product cell is covered by at least one
   arm (possibly via wildcards), no `otherwise:` is required. Otherwise the
   error names the discriminator(s) and lists uncovered tuples.

5. **First-match dispatch.** Where wildcards make arms overlap, the first
   matching arm in source order fires. To require non-overlap, place wildcard
   arms last.

6. **Single dispatch and staging.** Under `step staged:`, discriminators read
   the previous-phase value. Arm body writes commit at end of phase as normal.
   Exactly one arm fires per agent — even if an arm body mutates a discriminator
   expression, no other arm runs for the same agent in the same match.

7. **Scope.** Allowed wherever an agent update statement is allowed: inside
   an agent-set block, inside `where`/`otherwise` blocks, inside an action
   body, and inside another `match` arm.

8. **Inline agent-set match.** An agent-set update header may include `match`
   directly, eliding the wrapping update block:

   ```pets
   step:
     termites match state, patch.has-chip:
       wandering, true:  ...
       wandering, false: ...
       ...
   ```

   is sugar for:

   ```pets
   step:
     termites:
       match state, patch.has-chip:
         wandering, true:  ...
         ...
   ```

   The inline form's body is a sequence of match arms only — no other
   statements. A `where` clause may precede `match` to filter the agent set
   before dispatch: `flockers where (released) match state:`. The same sugar
   applies to `patches`, breed names, and zone names. To intermix statements
   with a match (e.g. per-agent prefatory `let`s or trailing motion), use the
   explicit nested form.

Design rationale, grammar sketch, and lowering strategy:
[docs/decisions/match-blocks.md](./decisions/match-blocks.md).

## The `patch` property

`patch` is the patch under the current pet, readable and writable wherever
the current pet is in scope — breed update blocks, action bodies, match arms:

- `patch.field` reads a patch field; the pet's continuous coordinates go
  through topology before the patch resolves.
- `patch.field := expr` writes one field; `patch := :` followed by an
  indented field map writes several. Writes target the global patch grid;
  multiple pets on the same patch writing the same field in the same tick
  race normally.
- `patch` is context-bound, not a first-class value: it must be followed by
  `.field` or stand as an assignment target, and no breed, patch field,
  zone, or memory declaration may reuse the name.
- It is not available in `patches:` updates, `zones:` updates, `defs:`,
  monitors, or stop conditions. `patch-at(x, y)` remains the parameterized
  lookup available in any context.

Rename history (from `patch-here()`):
[docs/decisions/patch-property.md](./decisions/patch-property.md).

## Teams

Multi-faction models declare a top-level `teams:` section and mark breeds
`per team`; the compiler stamps each such breed once per team
(`crimson-ants`, `azure-ants`, ...) and expands every `create` statement,
breed-update block, and `per team` monitor that names the template — with the
team's constants and `enemy <breed>` references substituted in. Full design,
supported `enemy` contexts, and the v1 scope live in
[teams-design.md](./teams-design.md); `packages/examples/src/models/ant-queens`
is the reference model.

## Sidecars

Presentation and presets live next to the source, not in it:
`styles.petstyle` (colors, sprites, monitor displays) and
`presets.petpreset` (named param bundles, optional wall maps). Both are YAML.

**Names use the source spelling.** Field, param, and monitor names in
sidecars are kebab-case, exactly as declared in the `.pet` file
(`diffusion-rate`, `food-source-number`); the compiled camelCase record keys
are an implementation detail and are rejected with a targeted error.
Display-schema keys (`groupLabel`, `shapeMode`, `minValue`, ...) are part of
the sidecar schema, not model identifiers, and stay as they are.

**Style rules match any declared field.** A rule's selector may target enum
states (`patch:food`), and attribute-match any field with `=` — booleans,
numbers, and enum values, multiple attributes AND-ed:

```yaml
rules:
  - selector: "patch[has-grass=false]"
    style:
      color: "#7b5a3e"
  - selector: "patch:food[food-source-number=1]"
    style:
      color: "#52d4ff"
```

Because rules can style boolean and numeric fields directly, models do not
need shadow `state` enums kept in sync with real fields just to be
paintable. Precedence: rules apply after `default:`/`states:`/`fields:`
styling; among rules, higher selector specificity wins and later rules break
ties.

Numeric fields can drive continuous color scales:

```yaml
patches:
  fields:
    chemical:
      color:
        scale: viridis
        domain: [0, 5]
```

Supported built-in scales: `viridis`, `inferno`, `magma`, `plasma`,
`cividis`, `turbo`, `warm`, `cool`, `cubehelix`, `rainbow`, `sinebow`; a
custom `range` of color strings may replace the named scale.

## Round-based models

Decision-model sections are named `round` (`turn` would collide with the
`turn(degrees)` command). The compiler and engine expose a transport-neutral
decision protocol that host applications can connect to human participants,
network peers, or other external processes.

A round-based model advances in discrete rounds instead of free-running ticks:
each round, designated agent fields are decided *externally and asynchronously*
(by a human participant, a network peer, or another host-controlled process).
Round-based models use
`round` sections **instead of** `step` sections; mixing `step:` and `round:`
sections in one model is a compile error.

```pets
pets:
  player players:             # ← a player breed: pets that take turns
    action: cooperate | defect = cooperate
    score: number = 0

round 8:                      # ← barrier section; "8" = decision deadline in seconds
  players:
    decide action             # ← this player's `action` is decided externally each round
    score := score + payoff(action)   # barrier transitions: run after ALL decisions

round async:                  # ← async section: runs per agent, the moment that
  players:                    #    agent's decision arrives
    state := ready
```

### Section forms

- `round <number>:` — the number is the decision deadline in **seconds**
  (fractional allowed, must be > 0). Exactly one `round` section must carry the
  deadline; additional `round:`, `round staged:`, and `round async:` sections
  inherit it. More than one deadline — or none at all — is a compile error.
- `round:` and `round staged:` — the **barrier phase**. They run once per round,
  after every decision has arrived or the deadline passed, with identical body
  grammar and semantics to today's `step:` / `step staged:` sections.
- `round async:` — the **async phase**. Same body grammar as `round:` except
  `decide` is not allowed. Only breed blocks of *deciding* breeds may appear
  inside (patch or observer statements are a compile error). The body runs
  once per agent, scoped to exactly the agent whose decision just arrived.

### `decide`

```pets
decide <field>[, <field>…]
```

Only valid directly inside a **player** breed block of a non-async `round`
section — a plain pet breed cannot `decide` (declare it `player <name>:`
to give it turns). Declares that the named fields of that player are decided
externally each round. The fields must be declared `own` fields of the breed
with enum, number, or boolean type; `state` cannot be decided.

### The implicit `decided` field

Every deciding breed gets an implicit `decided: boolean = false` field,
managed by the engine: `true` once the agent's external decision arrived this
round, `false` at round start and for agents that timed out (their decided
fields keep their previous values). Models may read `decided` anywhere, for
example `where (not decided): …`. Declaring a field named `decided` on a
deciding breed is a compile error.

## Model skeleton

Top-level section order (declaration sections in any order, lifecycle tail
ordered):

```pets
model:
  name: Example

defs:
  helper(value: number): number:
    value + 1

world:
  x: -25..25
  y: -18..18
  topology: box

params:
  density: number = slider(62, 0..100)

memory:
  generation: number = 0

monitors:
  burning: number = count patches where burning

patches:
  state: empty | tree | burning | burned = empty

pets:
  actions:
    wiggle(spread: number):
      turn(floor(random(spread)))
      turn(-floor(random(spread)))
      forward(1)

  cells:
    state: dead | alive = dead
    actions:
      wake-up:
        state := alive

setup:
  patches:
    state := empty
  create cells 10

step staged:
  patches where burning:
    state := burned

step:
  cells:
    wiggle(50)

brush:
  wall := true

stop when (count patches where burning = 0)
```

Round-based models replace or complement `step` sections with `round` sections
(see [Round-based models](#round-based-models)).

## Builtins reference

One rule for call syntax everywhere: **parens iff the call has arguments**
(`die`, `set-random-position`, `end1` are bare; `forward(1)`, `kill(prey)`
take parens). Rationale:
[docs/decisions/paren-less-commands.md](./decisions/paren-less-commands.md).

Context legend — **pet**: inside a breed update block; **patch**: inside a
`patches:` update; **link**: inside a link-breed update; **any agent**: pet,
patch, zone, or link block; **anywhere**: also monitors, `stop when`, defs.

### Commands

| Command | Context | Meaning |
| ------- | ------- | ------- |
| `forward(distance)` | pet | Move along the heading; ≤0.5-unit samples, blocked by walls, clamped/wrapped per topology |
| `turn(degrees)` | pet | Rotate clockwise relative to the current heading |
| `face(target [, percent])` | pet | Point at an agent; percent `0..100` turns partway |
| `turn-towards(heading, max)` / `turn-away(target, max)` | pet | Bounded alignment turns |
| `set-position(x, y)` | pet | Teleport (topology-normalized, ignores walls) |
| `set-random-position` | pet | Teleport to a uniform random position |
| `move-to(target)` | pet | Teleport to an agent's position (ignores walls) |
| `scatter spread [from <agent \| x, y>]` | pet | Uniform position in a square of side `spread` |
| `follow-patch-gradient(field [, min, max])` | pet | Turn uphill along a patch field; never into walls |
| `die` | pet | Remove the current pet |
| `kill(ref)` | pet | Remove the referenced pet; `kill(nobody)` is a runtime error |
| `hatch(breed)` | pet | Clone the current pet into `breed` |
| `create <breed> <count>` | setup/step | Observer-level creation; see also counted spawn blocks |
| `create-link-with(breed, target)` / `create-link-to(breed, target)` | pet | Undirected / directed link creation (re-creating refreshes decay) |
| `diffuse(field, rate)` | top level of a step/round | Mass-conserving patch diffusion; walls are inert |
| `diffuse(field, rate) over <link-breed>` | top level of a step/round | Diffuse a numeric pet field across the link graph |

### Lookups (truthy when found, falsy when not)

Field reads through a missing result are runtime errors — test the lookup
first (`where (pet-at(cars, px, py)):`). There is no `undefined` in the
language.

| Reporter | Context | Meaning |
| -------- | ------- | ------- |
| `patch-at(x, y)` | anywhere | Patch at coordinates (topology applied; nothing off a hard edge) |
| `pet-at(breed, x, y)` | anywhere | One pet of `breed` on the patch at coordinates |
| `neighbor-at(direction)` | patch | One relative neighbor (`top-left`, `top`, ..., `bottom-right`) |
| `zone-at(zones)` | patch | The zone containing the current patch |
| `one-of <agentset>` | any agent | Random member |
| `nearest <agentset>` | pet | Closest member (topology-aware) |
| `max-one-of` / `min-one-of <query> report (...)` | any agent | Random best-scoring member |

### Agentset queries and filters

| Form | Context | Meaning |
| ---- | ------- | ------- |
| `<breed>` / `patches` / `<link-breed>` / `<zone>` | anywhere | The whole set |
| `... where (predicate)` / `... where state-name` | anywhere | Filter (bare names lower to `state = name` or a boolean field) |
| `other <agentset>` | any agent | Excludes the current agent |
| `<breed> here` | any agent | Members on the current patch |
| `<agentset> in-radius r` / `in-square r` | pet | Members within range of the current pet (breed queries exclude self) |
| `patches in-radius r [around (x, y)]` | any agent / anywhere | Patch region; center defaults to the current agent, explicit elsewhere |
| `n random <agentset>` | any agent | Up to `n` distinct random members (filter applies first) |
| `link-neighbors[(link-breed)]` | pet | Adjacent pets over links |
| `links-with[(link-breed)]` | pet | Incident links |
| `in-links` / `out-links` / `in-link-neighbors` / `out-link-neighbors` `(link-breed)` | pet | Directed splits |
| `patches-in` | zone | Patches inside the current zone |
| `end1` / `end2` | link | Endpoint pets |

### Aggregates

`around (x, y)` scopes count/any/sum-style reporters to the eight patches
around a coordinate and is always explicit — without it the count is
set-wide in every context
([why](./decisions/query-ergonomics-around.md)).

| Form | Context |
| ---- | ------- |
| `count <query>` / `any <query>` | anywhere |
| `count/any neighbors4` / `neighbors8 [where ...]` | patch |
| `count/any neighbors-at(direction, ...) [where ...]` | patch |
| `count/any <agentset> [where ...] around (x, y)` | anywhere |
| `sum/mean/min/max <query> report (expr)` | anywhere |
| `count-in-radius(agentset, r)` | pet |
| `distance-to(agent)` | pet |
| `average-heading(agentset)` / `average-heading-towards(agentset)` | pet |
| `can-move(distance)` | pet |

### Values, math, and randomness

- Literals: numbers, booleans, enum values, set literals `[2, 3]` with `in`.
- `if (...) then ... else ...`; `and`, `or`, `not`; `=`, `!=`, `<`, `<=`,
  `>`, `>=`; `+`, `-`, `*`, `/`, `%`.
- `floor`, `ceil`, `round`, `abs`, `min`, `max`, `sqrt`, `pow`, `sin`,
  `cos`, `tan`, `clamp` (trig takes radians, not headings).
- `tick`; world bounds `min-x`, `max-x`, `min-y`, `max-y`.
- Agent surfaces: patches own `px`, `py`, the writable builtin `wall`; pets
  own `x`, `y`, `id`, `heading`, the builtin `hidden`; deciding breeds own
  the engine-managed `decided`.
- Context values: `patch` (patch under the current pet), `self` (current
  agent as a value), `mine.field` (the asker inside nested queries),
  `nobody`.
- `random-float(max)`, `random(max)`, `random-int(max)` — keyed by seed,
  tick, agent, and call site, so runs replay exactly.

### Statements

- `field := expr`, and multi-assignment `target := :` with an indented
  field map.
- `let name = expr` — immutable, per-agent in agent blocks.
- `where (...):` / `otherwise:` blocks; `match` tables over enum/boolean
  discriminators with exhaustiveness checking.
- `repeat n:` and `repeat i in a..b:` (inclusive, immutable index).
- `create <breed> <n>` and counted spawn blocks (`<n> <breed>:` + `spawn`).
- Actions: zero-arg (`wiggle`) or parameterized (`wiggle(50)`); arguments
  evaluate once in the caller's context.
- `decide field[, field...]` — player breeds in round sections only.

## Known gaps

- multiline expressions
- arbitrary observer-level blocks outside `defs:`
- action return values
- list values (`map`/`filter`/`foreach` over data, not agents)
- agentset unions across breeds (`enemy <breed>` in teams models is the
  stamped exception)
- parameter sweeps / batch runs (BehaviorSpace-style tooling)
