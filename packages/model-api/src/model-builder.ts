/**
 * Internal builder that assembles worlds, agents, params, and snapshots.
 *
 * This file is the main implementation of the model API. It owns world creation,
 * patch and pet records, param accessors, deterministic randomness, and the
 * cached snapshot logic consumed by the rest of the app.
 */
import {
  AgentQuery,
  SeededRandom,
  RoundFieldSpec,
  WorldConfig,
  WorldController,
  netLogoHeadingToVector,
  normalizeRandomSeed,
  normalizeHeading,
  wrapCoordinate,
} from "@pets/engine";
import {
  deriveFieldLabel,
  EditableBooleanFieldMeta,
  EditableEnumFieldMeta,
  EditableNumberFieldMeta,
  FieldMeta,
  ReadonlyBooleanFieldMeta,
  ReadonlyNumberFieldMeta,
} from "./fields";
import {
  BreedDefinition,
  LinkBreedDefinition,
  LinkRecord,
  ModelGlobals,
  ModelSnapshot,
  PatchNeighborDirection,
  PatchRecord,
  QueryMatcher,
  StateDefinitions,
  StateRegistry,
  TurtleRecord,
  WorldView,
} from "./agents";
import { ModelBoardConfig } from "./presentation";
import { matchesAgentSelector } from "./selectors";

const INITIAL_RANDOM_SEED = 1;

/**
 * Column-oriented storage for one patch field.
 *
 * `front` holds live values; `back` receives staged writes during a batch
 * pass and becomes the new front on commit (buffer swap). Numbers and
 * booleans use typed arrays; strings and other values use plain arrays.
 * Patch records expose these columns through per-field accessor properties,
 * so consumers still read and write ordinary record fields.
 */
interface PatchColumn {
  kind: "number" | "boolean" | "generic";
  front: Float64Array | Uint8Array | unknown[];
  back: Float64Array | Uint8Array | unknown[];
}

/** Non-enumerable grid index stamped on every patch record and draft. */
const PATCH_INDEX = Symbol("patchIndex");

function isRefFieldMeta(
  value: unknown,
): value is { kind: "ref"; to: string; initialValue: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "ref" &&
    typeof (value as { to?: unknown }).to === "string" &&
    "initialValue" in value
  );
}

function makePatchColumn(defaultValue: unknown, count: number): PatchColumn {
  if (isRefFieldMeta(defaultValue)) {
    return {
      kind: "number",
      front: new Float64Array(count).fill(-1),
      back: new Float64Array(count),
    };
  }

  if (typeof defaultValue === "number") {
    return {
      kind: "number",
      front: new Float64Array(count).fill(defaultValue),
      back: new Float64Array(count),
    };
  }

  if (typeof defaultValue === "boolean") {
    return {
      kind: "boolean",
      front: new Uint8Array(count).fill(defaultValue ? 1 : 0),
      back: new Uint8Array(count),
    };
  }

  return {
    kind: "generic",
    front: new Array(count).fill(defaultValue),
    back: new Array(count),
  };
}

/** Configuration accepted by {@link ModelBuilder.round}. */
export interface RoundConfigInput {
  /** Per-turn decision deadline in seconds (> 0, fractional allowed). */
  timeoutSeconds: number;
  /** Externally decided own-field names, keyed by deciding breed name. */
  decide: Record<string, readonly string[]>;
  /**
   * Autonomic `step` sub-steps to run per round, for models that mix
   * `round` and `step` sections. A fixed count keeps replay deterministic.
   * Defaults to 1; ignored by pure round-based models.
   */
  stepsPerRound?: number;
}

/**
 * Detects own-schema values declared with field metadata (e.g. via
 * `m.editable.enum("cooperate", { options: [...] })`) instead of a plain
 * default value. Metadata-shaped entries are unwrapped to their
 * `initialValue` when agents are created, and supply the enum membership
 * used to validate turn decisions.
 */
function isOwnFieldMeta(
  value: unknown,
): value is { kind: "editable"; type: string; initialValue: unknown; options?: readonly string[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "editable" &&
    typeof (value as { type?: unknown }).type === "string" &&
    "initialValue" in value
  );
}

const PATCH_NEIGHBOR_OFFSETS: Record<PatchNeighborDirection, { dx: number; dy: number }> = {
  "top-left": { dx: -1, dy: 1 },
  top: { dx: 0, dy: 1 },
  "top-right": { dx: 1, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  "bottom-left": { dx: -1, dy: -1 },
  bottom: { dx: 0, dy: -1 },
  "bottom-right": { dx: 1, dy: -1 },
};

/**
 * Fluent builder used by `defineModel` to assemble a model definition.
 *
 * The builder itself is internal, but the callback passed to `defineModel`
 * receives this instance and uses these methods as the canonical model API.
 */
export class ModelBuilder {
  [key: string]: unknown;

  /**
   * Helpers for declaring editable params.
   *
   * These methods return canonical field metadata consumed by
   * {@link ModelGlobals}.
   */
  readonly editable = {
    number: (
      value: number,
      meta: Omit<EditableNumberFieldMeta, "kind" | "type" | "initialValue"> = {},
    ) =>
      ({
        kind: "editable",
        type: "number",
        initialValue: value,
        step: 1,
        control: "slider",
        ...meta,
      }) as const,
    boolean: (
      value: boolean,
      meta: Omit<EditableBooleanFieldMeta, "kind" | "type" | "initialValue"> = {},
    ) => ({ kind: "editable", type: "boolean", initialValue: value, ...meta }) as const,
    enum: (
      value: string,
      meta: Omit<EditableEnumFieldMeta, "kind" | "type" | "initialValue">,
    ) => ({ kind: "editable", type: "enum", initialValue: value, ...meta }) as const,
  };

  /**
   * Helpers for declaring readonly params.
   *
   * `count` accepts either a numeric derivation or an {@link AgentQuery}; the
   * query form is evaluated lazily when the field is read.
   */
  readonly readonly = {
    number: (
      derive: () => number,
      meta: Omit<ReadonlyNumberFieldMeta, "kind" | "type" | "derive"> = {},
    ) =>
      ({ kind: "readonly", type: "number", derive, ...meta }) as const,
    count: <T extends object>(
      derive: () => number | AgentQuery<T>,
      meta: Omit<ReadonlyNumberFieldMeta, "kind" | "type" | "derive"> = {},
    ) =>
      ({
        kind: "readonly",
        type: "number",
        derive: () => {
          const value = derive();
          return typeof value === "number" ? value : value.count();
        },
        ...meta,
      }) as const,
    boolean: (
      derive: () => boolean,
      meta: Omit<ReadonlyBooleanFieldMeta, "kind" | "type" | "derive"> = {},
    ) => ({ kind: "readonly", type: "boolean", derive, ...meta }) as const,
  };

  refField(to: string) {
    return { kind: "ref" as const, to, initialValue: -1 };
  }

  readonly globalFields: ModelGlobals = {
    editable: {},
    readonly: {},
  };
  readonly paramFields = this.globalFields;
  readonly states: StateRegistry = {
    patches: {},
    breeds: {},
    links: {},
  };

  draw?: (view: WorldView) => void;
  private boardConfigFactory: () => ModelBoardConfig = () => ({});
  private roundConfigInput: RoundConfigInput | null = null;

  private randomSeed = INITIAL_RANDOM_SEED;
  private randomSeedPinned = false;
  private readonly rng = new SeededRandom(this.randomSeed);
  private readonly turtlesByBreed = new Map<string, TurtleRecord[]>();
  private readonly turtleSchemas = new Map<string, Record<string, unknown>>();
  /** Breeds declared `player <name>:` — pets that take rounds. */
  private readonly playerBreeds = new Set<string>();
  private readonly linksByBreed = new Map<string, LinkRecord[]>();
  private readonly linkSchemas = new Map<string, Record<string, unknown>>();
  private readonly linkBreedOptions = new Map<string, { directed: boolean; decay?: number }>();
  private patchSchema: Record<string, unknown> = {};
  private patchColumns = new Map<string, PatchColumn>();
  private patchGrid: PatchRecord[] = [];
  private patchDrafts: PatchRecord[] = [];
  private patchGridMinX = 0;
  private patchGridMinY = 0;
  private patchGridWidth = 0;
  private patchGridHeight = 0;
  private patchBatchDepth = 0;
  private brushHandler?: (patch: PatchRecord) => void;
  private registeredWallMap: {
    rows: string[];
    options: { centerX?: number; centerY?: number };
  } | null = null;
  private readonly globalValues: Record<string, unknown> = {};
  private cachedSnapshot: ModelSnapshot | null = null;
  private cachedRevision = -1;
  private nextTurtleId = 0;
  private nextLinkId = 0;
  private isRunningWrappedSetup = false;
  private isRunningWrappedStep = false;
  private stepAdvancedTicksExplicitly = false;
  private currentWorld = new WorldController({
    minX: -25,
    maxX: 25,
    minY: -18,
    maxY: 18,
    topology: "box",
  });

  constructor() {
    this.resetRandomState();
  }

  /**
   * Replaces the current world controller and rebuilds the patch grid.
   *
   * Cached snapshots are invalidated because both the world identity and its
   * revision semantics change.
   */
  world(config: WorldConfig) {
    this.currentWorld = new WorldController(config);
    this.currentWorld.random.setSeed(this.randomSeed);
    this.initializePatches();
    this.cachedSnapshot = null;
    this.cachedRevision = -1;
    return this.currentWorld;
  }

  /**
   * Reconfigures the existing world controller without replacing the instance.
   *
   * This keeps existing subscriptions attached while refreshing the patch grid.
   */
  reconfigureWorld(config: WorldConfig) {
    this.currentWorld.reconfigure(config);
    this.initializePatches();
    this.cachedSnapshot = null;
    this.cachedRevision = -1;
  }

  /**
   * Declares model params.
   *
   * Editable params are initialized from `initialValue`. Readonly params are
   * exposed as derived accessors. When a label is omitted, a readable label is
   * derived from the key.
   */
  params(schema: Record<string, FieldMeta>) {
    this.globals(schema);
  }

  /** Alias for {@link params}. */
  globals(schema: Record<string, FieldMeta>) {
    for (const [key, value] of Object.entries(schema)) {
      const field =
        typeof value.label === "string" && value.label.trim().length > 0
          ? value
          : { ...value, label: deriveFieldLabel(key) };

      if (field.kind === "editable") {
        this.globalFields.editable[key] = field;
        this.globalValues[key] = field.initialValue;
      } else {
        this.globalFields.readonly[key] = field;
      }

      if (!Object.prototype.hasOwnProperty.call(this, key)) {
        Object.defineProperty(this, key, {
          configurable: true,
          enumerable: true,
          get: () => this.readGlobalValue(key),
          set: (nextValue: unknown) => {
            this.setGlobalValue(key, nextValue);
          },
        });
      }
    }
  }

  /** Configures board rendering settings. */
  board(config: ModelBoardConfig | (() => ModelBoardConfig)) {
    this.boardConfigFactory =
      typeof config === "function" ? config : () => config;
  }

  /**
   * Declares this model as round-based (see docs/round-based-models.md).
   *
   * Each turn, the named own fields of the deciding breeds are decided
   * externally via `world.submitDecision`; the barrier `world.step` only runs
   * once every decision arrived or `timeoutSeconds` elapsed. Callable exactly
   * once; the configuration is installed on the world controller when the
   * model is finalized, so it works regardless of `m.world(...)` ordering.
   * Models that never call `m.round` behave exactly as before.
   */
  turn(config: RoundConfigInput) {
    if (this.roundConfigInput) {
      throw new Error("m.turn(...) may only be called once per model.");
    }

    const timeoutSeconds = config?.timeoutSeconds;
    if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new Error("m.turn(...) requires a finite timeoutSeconds greater than zero.");
    }

    const decideEntries = Object.entries(config.decide ?? {});
    if (decideEntries.length === 0) {
      throw new Error("m.turn(...) requires at least one deciding breed in `decide`.");
    }

    for (const [breed, fields] of decideEntries) {
      if (!Array.isArray(fields) || fields.length === 0) {
        throw new Error(`m.turn(...): breed "${breed}" must decide at least one field.`);
      }

      for (const field of fields) {
        if (typeof field !== "string" || field.trim().length === 0) {
          throw new Error(`m.turn(...): breed "${breed}" has an invalid decide field name.`);
        }
      }
    }

    const stepsPerRound = config.stepsPerRound ?? 1;
    if (!Number.isFinite(stepsPerRound) || stepsPerRound < 1) {
      throw new Error("m.round(...) requires stepsPerRound to be a finite number >= 1.");
    }

    this.roundConfigInput = {
      timeoutSeconds,
      decide: config.decide,
      stepsPerRound: Math.floor(stepsPerRound),
    };
  }

  /**
   * Reserved hook for pet schema declaration.
   *
   * The current implementation keeps pet schema registration on the breed
   * handle returned by {@link petBreed}.
   */
  petsOwn(_schema: Record<string, unknown>) {}

  /** Legacy alias for {@link petsOwn}. */
  turtlesOwn(schema: Record<string, unknown>) {
    this.petsOwn(schema);
  }

  private normalizeStateDefinitions(states?: StateDefinitions) {
    if (!states) {
      return {};
    }

    if (Array.isArray(states)) {
      return Object.fromEntries(states.map((state) => [state, {}]));
    }

    return states;
  }

  /**
   * Declares patch-owned fields and optional patch states.
   *
   * Existing patches are rebuilt so the new schema and default values are
   * present on every patch in the world.
   */
  patchesOwn(
    schema: Record<string, unknown>,
    options?: { states?: StateDefinitions },
  ) {
    this.patchSchema = schema;
    this.states.patches = this.normalizeStateDefinitions(options?.states);
    this.initializePatches();
  }

  /**
   * Stamps `wall = true` on patches matching `#` characters in `rows`.
   *
   * Rows are listed top-to-bottom: the first row maps to the highest patch
   * row (largest `py`). The map is centered on the world unless `centerX`/
   * `centerY` are provided; cells that fall outside the world are clipped
   * (never wrapped). Existing walls outside the map are left untouched.
   * Emits a world change so subscribers re-render.
   */
  applyWallMap(rows: string[], options: { centerX?: number; centerY?: number } = {}) {
    this.stampWallMap(rows, options);
    this.currentWorld.emit();
  }

  /**
   * Registers a wall map that persists across restarts.
   *
   * The map is stamped immediately (replacing any existing walls) and
   * re-stamped automatically whenever the runtime state is rebuilt, so the
   * layout survives reset. Pass `null` to unregister and clear all walls.
   */
  setWallMap(rows: string[] | null, options: { centerX?: number; centerY?: number } = {}) {
    this.registeredWallMap = rows ? { rows, options } : null;

    for (const patch of this.patchGrid) {
      patch.wall = false;
    }

    if (this.registeredWallMap) {
      this.stampWallMap(this.registeredWallMap.rows, this.registeredWallMap.options);
    }

    this.currentWorld.emit();
  }

  private stampWallMap(rows: string[], options: { centerX?: number; centerY?: number } = {}) {
    const { minX, maxX, minY, maxY } = this.currentWorld.config;
    const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
    const height = rows.length;
    const centerX = options.centerX ?? (minX + maxX) / 2;
    const centerY = options.centerY ?? (minY + maxY) / 2;
    const startX = Math.round(centerX - (width - 1) / 2);
    const topY = Math.round(centerY + (height - 1) / 2);

    rows.forEach((row, rowIndex) => {
      const py = topY - rowIndex;
      for (let column = 0; column < row.length; column += 1) {
        if (row[column] !== "#") {
          continue;
        }

        // Raw grid lookup: wall maps clip at the world edge, never wrap.
        const patch = this.patchAtGridCoordinate(startX + column, py);
        if (patch) {
          patch.wall = true;
        }
      }
    });
  }

  /** Clears the `wall` flag on every patch and emits a world change. */
  clearWalls() {
    for (const patch of this.patchGrid) {
      patch.wall = false;
    }

    this.currentWorld.emit();
  }

  /**
   * Registers the brush handler compiled from a Pets `brush:` section.
   *
   * The handler receives the single patch the user clicked.
   */
  brush(handler: (patch: PatchRecord) => void) {
    this.brushHandler = handler;
  }

  /** Returns true when a brush handler has been registered. */
  get hasBrush() {
    return this.brushHandler !== undefined;
  }

  /**
   * Runs the registered brush against the patch at `(px, py)`.
   *
   * The lookup is topology-aware (coordinates are wrapped or rejected exactly
   * like other patch lookups). Runs between ticks: brush randomness uses the
   * keyed per-agent random helpers, so it never consumes sequential random
   * state from the simulation. Emits a world change so the UI updates.
   */
  applyBrush(px: number, py: number) {
    const handler = this.brushHandler;
    if (!handler) {
      return;
    }

    const patch = this.patchAtPoint(px, py);
    if (!patch) {
      return;
    }

    handler(patch);
    this.currentWorld.emit();
  }

  /**
   * Removes all pets, resets pet IDs, rebuilds patches, and returns the
   * world to the idle state.
   */
  clearAll() {
    this.clearRuntimeState();
    this.currentWorld.reset();
  }

  private clearRuntimeState() {
    this.turtlesByBreed.clear();
    this.linksByBreed.clear();
    this.nextTurtleId = 0;
    this.nextLinkId = 0;
    this.initializePatches();

    if (this.registeredWallMap) {
      this.stampWallMap(this.registeredWallMap.rows, this.registeredWallMap.options);
    }

    this.currentWorld.ticks = 0;
    this.prepareRandomStateForRun();
  }

  /**
   * Declares a pet breed and its optional state registry.
   *
   * The returned breed handle is used for creation and breed-scoped queries.
   */
  petBreed(
    name: string,
    options?: { states?: StateDefinitions; player?: boolean },
  ): BreedDefinition {
    if (!this.turtlesByBreed.has(name)) {
      this.turtlesByBreed.set(name, []);
    }

    if (options?.player) {
      this.playerBreeds.add(name);
    }

    this.states.breeds[name] = this.normalizeStateDefinitions(options?.states);

    return {
      name,
      own: (schema) => {
        this.turtleSchemas.set(name, schema);
      },
      all: (...matchers: QueryMatcher<TurtleRecord>[]) => this.queryBreed(name, ...matchers),
      filter: (...matchers) => this.queryBreed(name, ...matchers),
    };
  }

  /** Legacy alias for {@link petBreed}. */
  turtleBreed(name: string, options?: { states?: StateDefinitions; player?: boolean }): BreedDefinition {
    return this.petBreed(name, options);
  }

  /** Names of breeds declared `player <name>:` — the turn-taking pets. */
  playerBreedNames(): string[] {
    return [...this.playerBreeds];
  }

  /** Whether `name` is a player breed. */
  isPlayerBreed(name: string): boolean {
    return this.playerBreeds.has(name);
  }

  /** Declares a link breed and its optional state registry. */
  linkBreed(
    name: string,
    options: { directed?: boolean; decay?: number; states?: StateDefinitions } = {},
  ): LinkBreedDefinition {
    if (!this.linksByBreed.has(name)) {
      this.linksByBreed.set(name, []);
    }

    const directed = options.directed === true;
    const decay = options.decay;
    this.linkBreedOptions.set(name, { directed, ...(decay === undefined ? {} : { decay }) });
    this.states.links[name] = this.normalizeStateDefinitions(options.states);

    return {
      name,
      directed,
      ...(decay === undefined ? {} : { decay }),
      own: (schema) => {
        this.linkSchemas.set(name, schema);
      },
      all: (...matchers: QueryMatcher<LinkRecord>[]) => this.queryLinkBreed(name, ...matchers),
      filter: (...matchers) => this.queryLinkBreed(name, ...matchers),
    };
  }

  /** Creates `count` pets for the given breed. */
  createPets(
    breed: BreedDefinition,
    count: number,
    init?: (pet: TurtleRecord) => void,
  ) {
    const turtles = this.turtlesByBreed.get(breed.name) ?? [];

    for (let index = 0; index < count; index += 1) {
      const pet = this.makeTurtle(breed.name);
      turtles.push(pet);
      init?.(pet);
    }

    this.turtlesByBreed.set(breed.name, turtles);
  }

  /** Legacy alias for {@link createPets}. */
  createTurtles(
    breed: BreedDefinition,
    count: number,
    init?: (turtle: TurtleRecord) => void,
  ) {
    this.createPets(breed, count, init);
  }

  /** Creates and returns a single pet for the given breed. */
  createPet(
    breed: BreedDefinition,
    init?: (pet: TurtleRecord) => void,
  ) {
    const pet = this.makeTurtle(breed.name);
    const turtles = this.turtlesByBreed.get(breed.name) ?? [];
    turtles.push(pet);
    this.turtlesByBreed.set(breed.name, turtles);
    init?.(pet);
    return pet;
  }

  /** Legacy alias for {@link createPet}. */
  createTurtle(
    breed: BreedDefinition,
    init?: (turtle: TurtleRecord) => void,
  ) {
    return this.createPet(breed, init);
  }

  /** Removes a pet by id from its breed collection. */
  removePet(pet: TurtleRecord) {
    const turtles = this.turtlesByBreed.get(pet.breed);
    if (!turtles) {
      return;
    }

    const index = turtles.findIndex((candidate) => candidate.id === pet.id);
    if (index >= 0) {
      turtles.splice(index, 1);
    }

    for (const [breedName, links] of this.linksByBreed) {
      this.linksByBreed.set(
        breedName,
        links.filter((link) => link.end1Id !== pet.id && link.end2Id !== pet.id),
      );
    }
  }

  /** Legacy alias for {@link removePet}. */
  removeTurtle(turtle: TurtleRecord) {
    this.removePet(turtle);
  }

  /**
   * Resets the tick counter and marks the world ready.
   */
  resetTicks() {
    this.currentWorld.ticks = 0;

    if (this.isRunningWrappedSetup) {
      return;
    }

    this.currentWorld.markReady();
  }

  /** Increments the tick counter. */
  tick() {
    if (this.isRunningWrappedStep) {
      this.stepAdvancedTicksExplicitly = true;
    }

    this.currentWorld.ticks += 1;
  }

  /** Returns the current tick count. */
  ticks() {
    return this.currentWorld.ticks;
  }

  /** Returns a deterministic random float in `[0, max)`. */
  random(max: number) {
    return this.rng.float(max);
  }

  /** Alias for {@link random}. */
  randomFloat(max: number) {
    return this.rng.float(max);
  }

  /** Returns a deterministic random integer in `[0, max)`. */
  randomInt(max: number) {
    return this.rng.int(max);
  }

  /** Returns a deterministic random value centered around zero. */
  randomCentered(span: number) {
    return this.rng.centered(span);
  }

  /** Returns a keyed deterministic random float without consuming sequence state. */
  randomFor(agent: PatchRecord | TurtleRecord | LinkRecord | undefined, salt: string | number, max = 1) {
    return this.rng.keyedFloat(max, "tick", this.currentWorld.ticks, this.agentRandomKey(agent), salt);
  }

  /** Alias for {@link randomFor}. */
  randomFloatFor(agent: PatchRecord | TurtleRecord | LinkRecord | undefined, salt: string | number, max = 1) {
    return this.randomFor(agent, salt, max);
  }

  /** Returns a keyed deterministic random integer without consuming sequence state. */
  randomIntFor(agent: PatchRecord | TurtleRecord | LinkRecord | undefined, salt: string | number, max: number) {
    return this.rng.keyedInt(max, "tick", this.currentWorld.ticks, this.agentRandomKey(agent), salt);
  }

  /**
   * Seeds both the model RNG and the world RNG.
   *
   * This keeps query ordering and simulation randomness aligned.
   */
  setSeed(seed: number | string, options: { pinned?: boolean } = {}) {
    this.randomSeed = normalizeRandomSeed(seed);
    this.randomSeedPinned = options.pinned ?? true;
    this.resetRandomState();
    this.currentWorld.emit();
  }

  /** Alias used by UI/runtime callers. */
  setRandomSeed(seed: number | string, options?: { pinned?: boolean }) {
    this.setSeed(seed, options);
  }

  /** Returns the seed used to reset deterministic random state. */
  getRandomSeed() {
    return this.randomSeed;
  }

  /** Returns true when setup keeps reusing the current seed. */
  isRandomSeedPinned() {
    return this.randomSeedPinned;
  }

  /** Returns to rolling a fresh seed for each setup run. */
  clearRandomSeed() {
    this.randomSeedPinned = false;
    this.resetRandomState();
    this.currentWorld.emit();
  }

  /**
   * Updates an agent's state bookkeeping.
   *
   * `previousState` records the prior state only when the agent explicitly
   * tracks that field.
   */
  setState(
    agent: {
      state?: unknown;
      previousState?: unknown;
    },
    nextState: string,
  ) {
    if (Object.prototype.hasOwnProperty.call(agent, "previousState")) {
      agent.previousState = agent.state;
    }
    agent.state = nextState;
  }

  /**
   * Diffuses a numeric patch field across the eight-neighbor neighborhood.
   *
   * The computation is two-phase so every patch uses the original values from
   * the start of the diffusion pass.
   *
   * Wall patches are fully isolated: they neither donate (their field value
   * stays put) nor receive. Donors keep the share that would have gone to
   * wall neighbors, so the diffusion remains mass-conserving.
   */
  diffuse(field: string, amount: number) {
    const nextValues = new Map<PatchRecord, number>();
    const patches = this.patches().toArray();

    for (const patch of patches) {
      if (patch.wall === true) {
        continue;
      }

      const value = Number(patch[field] ?? 0);
      const share = (value * amount) / 8;
      const neighbors = patch
        .neighbors8()
        .toArray()
        .filter((neighbor) => neighbor.wall !== true);

      nextValues.set(patch, (nextValues.get(patch) ?? 0) + value - share * neighbors.length);

      for (const neighbor of neighbors) {
        nextValues.set(neighbor, (nextValues.get(neighbor) ?? 0) + share);
      }
    }

    for (const patch of patches) {
      if (patch.wall === true) {
        continue;
      }

      patch[field] = nextValues.get(patch) ?? 0;
    }
  }

  /**
   * Diffuses a numeric pet field across a link graph, mirroring {@link diffuse}
   * but over link-neighbors instead of the eight patch neighbors. Directed
   * breeds flow along out-links; undirected breeds split across all neighbors.
   * Mass-conserving and two-phase; isolated pets keep their value. Only pets
   * that carry the numeric field participate.
   */
  diffuseLinks(field: string, amount: number, breed: LinkBreedDefinition) {
    const pets = this.turtles()
      .toArray()
      .filter((pet) => typeof pet[field] === "number");
    const nextValues = new Map<TurtleRecord, number>();

    for (const pet of pets) {
      const value = Number(pet[field] ?? 0);
      const neighbors = (
        breed.directed
          ? this.outLinkNeighbors(pet, breed)
          : this.linkNeighbors(pet, breed)
      )
        .toArray()
        .filter((neighbor) => typeof neighbor[field] === "number");
      const degree = neighbors.length;
      const share = degree > 0 ? (value * amount) / degree : 0;

      nextValues.set(pet, (nextValues.get(pet) ?? 0) + value - share * degree);

      for (const neighbor of neighbors) {
        nextValues.set(neighbor, (nextValues.get(neighbor) ?? 0) + share);
      }
    }

    for (const pet of pets) {
      pet[field] = nextValues.get(pet) ?? Number(pet[field] ?? 0);
    }
  }

  /** Creates one link for the given breed and endpoint pair. */
  createLink(
    breed: LinkBreedDefinition,
    end1: TurtleRecord | undefined,
    end2: TurtleRecord | undefined,
    init?: (link: LinkRecord) => void,
  ) {
    if (!end1 || !end2 || end1.id === end2.id) {
      return undefined;
    }

    const links = this.linksByBreed.get(breed.name) ?? [];
    const existing = links.find((candidate) =>
      this.sameLinkEndpoints(candidate, end1, end2, breed.directed),
    );

    if (existing) {
      // Re-creating an existing link refreshes it, restarting decay aging.
      existing.refreshedTick = this.currentWorld.ticks;
      return existing;
    }

    const link = this.makeLink(breed, end1, end2);
    links.push(link);
    this.linksByBreed.set(breed.name, links);
    init?.(link);
    return link;
  }

  /** Removes a link by id from its breed collection. */
  removeLink(link: LinkRecord) {
    const links = this.linksByBreed.get(link.breed);
    if (!links) {
      return;
    }

    const index = links.findIndex((candidate) => candidate.id === link.id);
    if (index >= 0) {
      links.splice(index, 1);
    }
  }

  /** Returns all pets, optionally filtered by query matchers. */
  pets(): AgentQuery<TurtleRecord>;
  /** Returns all pets, optionally filtered by query matchers. */
  pets(...matchers: QueryMatcher<TurtleRecord>[]): AgentQuery<TurtleRecord>;
  pets(...matchers: QueryMatcher<TurtleRecord>[]) {
    const query = new AgentQuery(
      () => Array.from(this.turtlesByBreed.values()).flat(),
      this.currentWorld.random,
      {
        distanceBetween: (left, right) =>
          this.distanceBetweenPoints(left.x, left.y, right.x, right.y),
        isSame: (left, right) => left.id === right.id,
        stringMatcher: (item, matcher) => this.matchesTurtleStringMatcher(item, matcher),
      },
    );

    return matchers.length > 0 ? query.filter(...matchers) : query;
  }

  /** Legacy alias for {@link pets}. */
  turtles(): AgentQuery<TurtleRecord>;
  /** Legacy alias for {@link pets}. */
  turtles(...matchers: QueryMatcher<TurtleRecord>[]): AgentQuery<TurtleRecord>;
  turtles(...matchers: QueryMatcher<TurtleRecord>[]) {
    return this.pets(...matchers);
  }

  /** Returns the number of pets matching the provided filters. */
  countPets(...matchers: QueryMatcher<TurtleRecord>[]) {
    return this.pets(...matchers).count();
  }

  /** Legacy alias for {@link countPets}. */
  countTurtles(...matchers: QueryMatcher<TurtleRecord>[]) {
    return this.countPets(...matchers);
  }

  /** Returns all links, optionally filtered by query matchers. */
  links(): AgentQuery<LinkRecord>;
  /** Returns all links, optionally filtered by query matchers. */
  links(...matchers: QueryMatcher<LinkRecord>[]): AgentQuery<LinkRecord>;
  links(...matchers: QueryMatcher<LinkRecord>[]) {
    const query = new AgentQuery(
      () => Array.from(this.linksByBreed.values()).flat(),
      this.currentWorld.random,
      {
        isSame: (left, right) => left.id === right.id,
        stringMatcher: (item, matcher) => this.matchesLinkStringMatcher(item, matcher),
      },
    );

    return matchers.length > 0 ? query.filter(...matchers) : query;
  }

  /** Returns all links incident to a pet, optionally filtered by breed. */
  linksOf(
    pet: TurtleRecord | undefined,
    breed?: LinkBreedDefinition,
  ) {
    if (!pet) {
      return new AgentQuery<LinkRecord>(() => [], this.currentWorld.random);
    }

    const root = breed ? this.queryLinkBreed(breed.name) : this.links();
    return root.filter((link) => link.end1Id === pet.id || link.end2Id === pet.id);
  }

  /** Returns pets connected to the provided pet by links. */
  linkNeighbors(
    pet: TurtleRecord | undefined,
    breed?: LinkBreedDefinition,
  ) {
    if (!pet) {
      return new AgentQuery<TurtleRecord>(() => [], this.currentWorld.random);
    }

    return new AgentQuery(
      () =>
        this.linksOf(pet, breed)
          .map((link) => link.otherEnd(pet))
          .filter((neighbor): neighbor is TurtleRecord => Boolean(neighbor)),
      this.currentWorld.random,
      {
        distanceBetween: (left, right) =>
          this.distanceBetweenPoints(left.x, left.y, right.x, right.y),
        isSame: (left, right) => left.id === right.id,
        stringMatcher: (item, matcher) => this.matchesTurtleStringMatcher(item, matcher),
      },
    );
  }

  /**
   * Returns links pointing into a pet (the pet is `end2`). Undirected links
   * are counted in both directions, so on an undirected breed this equals
   * {@link linksOf}.
   */
  linksInto(pet: TurtleRecord | undefined, breed?: LinkBreedDefinition) {
    if (!pet) {
      return new AgentQuery<LinkRecord>(() => [], this.currentWorld.random);
    }

    const root = breed ? this.queryLinkBreed(breed.name) : this.links();
    return root.filter(
      (link) => link.end2Id === pet.id || (!link.directed && link.end1Id === pet.id),
    );
  }

  /**
   * Returns links pointing out of a pet (the pet is `end1`). Undirected links
   * are counted in both directions, so on an undirected breed this equals
   * {@link linksOf}.
   */
  linksOutOf(pet: TurtleRecord | undefined, breed?: LinkBreedDefinition) {
    if (!pet) {
      return new AgentQuery<LinkRecord>(() => [], this.currentWorld.random);
    }

    const root = breed ? this.queryLinkBreed(breed.name) : this.links();
    return root.filter(
      (link) => link.end1Id === pet.id || (!link.directed && link.end2Id === pet.id),
    );
  }

  /** Returns pets that link into the provided pet (its in-neighbors). */
  inLinkNeighbors(pet: TurtleRecord | undefined, breed?: LinkBreedDefinition) {
    if (!pet) {
      return new AgentQuery<TurtleRecord>(() => [], this.currentWorld.random);
    }

    return new AgentQuery(
      () =>
        this.linksInto(pet, breed)
          .map((link) => link.otherEnd(pet))
          .filter((neighbor): neighbor is TurtleRecord => Boolean(neighbor)),
      this.currentWorld.random,
      {
        distanceBetween: (left, right) =>
          this.distanceBetweenPoints(left.x, left.y, right.x, right.y),
        isSame: (left, right) => left.id === right.id,
        stringMatcher: (item, matcher) => this.matchesTurtleStringMatcher(item, matcher),
      },
    );
  }

  /** Returns pets the provided pet links out to (its out-neighbors). */
  outLinkNeighbors(pet: TurtleRecord | undefined, breed?: LinkBreedDefinition) {
    if (!pet) {
      return new AgentQuery<TurtleRecord>(() => [], this.currentWorld.random);
    }

    return new AgentQuery(
      () =>
        this.linksOutOf(pet, breed)
          .map((link) => link.otherEnd(pet))
          .filter((neighbor): neighbor is TurtleRecord => Boolean(neighbor)),
      this.currentWorld.random,
      {
        distanceBetween: (left, right) =>
          this.distanceBetweenPoints(left.x, left.y, right.x, right.y),
        isSame: (left, right) => left.id === right.id,
        stringMatcher: (item, matcher) => this.matchesTurtleStringMatcher(item, matcher),
      },
    );
  }

  /** Returns the number of links matching the provided filters. */
  countLinks(...matchers: QueryMatcher<LinkRecord>[]) {
    return this.links(...matchers).count();
  }

  /** Returns all patches, optionally filtered by query matchers. */
  patches(): AgentQuery<PatchRecord>;
  /** Returns all patches, optionally filtered by query matchers. */
  patches(...matchers: QueryMatcher<PatchRecord>[]): AgentQuery<PatchRecord>;
  patches(...matchers: QueryMatcher<PatchRecord>[]) {
    const query = new AgentQuery(
      () => [...this.patchGrid],
      this.currentWorld.random,
      {
        distanceBetween: (left, right) =>
          this.distanceBetweenPoints(left.px, left.py, right.px, right.py),
        isSame: (left, right) => left.px === right.px && left.py === right.py,
        stringMatcher: (item, matcher) => this.matchesPatchStringMatcher(item, matcher),
        batchApply: (items, effect) => this.applyPatchBatch(items, effect),
      },
    );

    return matchers.length > 0 ? query.filter(...matchers) : query;
  }

  /** Returns the number of patches matching the provided filters. */
  countPatches(...matchers: QueryMatcher<PatchRecord>[]) {
    return this.patches(...matchers).count();
  }

  /** Returns the patch at the given coordinates after applying world topology. */
  patchAt(px: number, py: number) {
    const normalized = this.normalizePatchCoordinate(px, py);
    if (!normalized) {
      return undefined;
    }

    return this.patchAtGridCoordinate(normalized.px, normalized.py);
  }

  /**
   * Returns the patch at exact integer grid coordinates without topology
   * wrapping. Non-integer and out-of-bounds coordinates return `undefined`.
   */
  private patchAtGridCoordinate(px: number, py: number) {
    const column = px - this.patchGridMinX;
    const row = py - this.patchGridMinY;
    if (column < 0 || column >= this.patchGridWidth || row < 0 || row >= this.patchGridHeight) {
      return undefined;
    }

    return this.patchGrid[column * this.patchGridHeight + row];
  }

  /**
   * Updates an editable param and emits or resets the world as needed.
   *
   * Params configured with `apply: "setup"` defer their reset effect to the
   * next setup cycle if the world is actively running.
   */
  setParamValue(key: string, value: unknown) {
    this.setGlobalValue(key, value);
  }

  /** Alias for {@link setParamValue}. */
  setGlobalValue(key: string, value: unknown) {
    // Params compile to camelCase record keys, but hosts (guide demos,
    // presets, external harnesses) address them by their source spelling.
    const compiledKey = key.replace(/-([a-zA-Z0-9])/g, (_match, character: string) =>
      character.toUpperCase(),
    );
    const meta = this.globalFields.editable[compiledKey];

    if (!meta) {
      throw new Error(`Param "${key}" is not editable.`);
    }

    this.globalValues[compiledKey] = value;

    if (meta.apply === "setup" && this.currentWorld.status() === "running") {
      this.currentWorld.emit();
      return;
    }

    this.currentWorld.emit();
  }

  /** Exposes the live world controller used by the model. */
  get worldController() {
    return this.currentWorld;
  }

  /**
   * Builds plain snapshot records for every patch directly from the columns.
   *
   * Patch data fields live on shared prototype accessors, so the spread the
   * pet and link snapshots use would come up empty here. Reading the columns
   * directly is also much faster: values are materialized field-by-field
   * (column-major) into plain objects with no getter dispatch per record.
   * Neighbor query helpers are carried over by reference, like the spread
   * used to.
   */
  private snapshotPatches(): PatchRecord[] {
    const count = this.patchGrid.length;
    const records: PatchRecord[] = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const live = this.patchGrid[i];
      records[i] = {
        px: live.px,
        py: live.py,
        neighbors4: live.neighbors4,
        neighbors8: live.neighbors8,
        neighborAt: live.neighborAt,
        neighborsAt: live.neighborsAt,
      } as PatchRecord;
    }

    for (const [field, column] of this.patchColumns) {
      if (column.kind === "boolean") {
        const front = column.front as Uint8Array;
        for (let i = 0; i < count; i += 1) {
          records[i][field] = front[i] !== 0;
        }
      } else {
        const front = column.front as unknown[];
        for (let i = 0; i < count; i += 1) {
          records[i][field] = front[i];
        }
      }
    }

    return records;
  }

  private snapshotTurtles() {
    return this.pets().map((pet) => {
      const copy: any = {};
      const schema = this.turtleSchemas.get(pet.breed) ?? {};
      for (const [key, val] of Object.entries(pet)) {
        const meta = schema[key];
        if (isRefFieldMeta(meta)) {
          copy[key] = (pet as any)[`_ref_raw_id_${key}`] ?? -1;
        } else {
          copy[key] = val;
        }
      }
      return copy;
    });
  }

  private snapshotLinks() {
    return this.links().map((link) => {
      const copy: any = {};
      const schema = this.linkSchemas.get(link.breed) ?? {};
      for (const [key, val] of Object.entries(link)) {
        const meta = schema[key];
        if (isRefFieldMeta(meta)) {
          copy[key] = (link as any)[`_ref_raw_id_${key}`] ?? -1;
        } else {
          copy[key] = val;
        }
      }
      return copy;
    });
  }

  /**
   * Returns a cached snapshot for the current world revision.
   *
   * The snapshot is recomputed only when the world revision changes.
   */
  getSnapshot(): ModelSnapshot {
    const revision = this.currentWorld.getRevision();

    if (this.cachedSnapshot && this.cachedRevision === revision) {
      return this.cachedSnapshot;
    }

    this.cachedRevision = revision;
    const params = this.collectParams();
    this.cachedSnapshot = {
      ticks: this.currentWorld.ticks,
      randomSeed: this.randomSeed,
      randomSeedPinned: this.randomSeedPinned,
      status: this.currentWorld.status(),
      globals: params,
      params,
      round: this.currentWorld.roundSnapshot() ?? undefined,
      patches: this.snapshotPatches(),
      turtles: this.snapshotTurtles(),
      links: this.snapshotLinks(),
    };

    return this.cachedSnapshot;
  }

  /**
   * Returns a stable snapshot suitable for server rendering.
   *
   * This reuses the first computed snapshot until the cache is invalidated by
   * rebuilding or reconfiguring the world.
   */
  getServerSnapshot(): ModelSnapshot {
    if (this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    const params = this.collectParams();
    this.cachedSnapshot = {
      ticks: this.currentWorld.ticks,
      randomSeed: this.randomSeed,
      randomSeedPinned: this.randomSeedPinned,
      status: this.currentWorld.status(),
      globals: params,
      params,
      round: this.currentWorld.roundSnapshot() ?? undefined,
      patches: this.snapshotPatches(),
      turtles: this.snapshotTurtles(),
      links: this.snapshotLinks(),
    };

    return this.cachedSnapshot;
  }

  /**
   * Wraps setup and step callbacks with lifecycle bookkeeping.
   *
   * Setup is treated as a full reset path: the builder clears existing runtime
   * state before the model-specific setup logic runs, then transitions the
   * world to `ready` so consumers observe the rebuilt snapshot.
   */
  /**
   * Removes links from decaying breeds that outlived their decay window.
   *
   * Runs after every completed tick. A link survives `decay` ticks past its
   * `refreshedTick` — the tick it was created or last re-created. Rounds
   * advance ticks once per barrier, so decay counts rounds in round models.
   */
  private expireDecayedLinks() {
    for (const [name, options] of this.linkBreedOptions) {
      if (options.decay === undefined) {
        continue;
      }

      const links = this.linksByBreed.get(name);
      if (!links || links.length === 0) {
        continue;
      }

      const cutoff = this.currentWorld.ticks - options.decay;
      const survivors = links.filter((link) => Number(link.refreshedTick ?? 0) >= cutoff);
      if (survivors.length !== links.length) {
        this.linksByBreed.set(name, survivors);
      }
    }
  }

  finalize() {
    const initialSetup = this.currentWorld.setup;
    const initialStep = this.currentWorld.step;

    if (initialSetup) {
      this.currentWorld.setup = () => {
        this.clearRuntimeState();
        this.isRunningWrappedSetup = true;
        try {
          initialSetup();
        } finally {
          this.isRunningWrappedSetup = false;
        }
        this.currentWorld.markReady();
      };
    }

    if (initialStep) {
      this.currentWorld.step = () => {
        this.stepAdvancedTicksExplicitly = false;
        this.isRunningWrappedStep = true;
        try {
          initialStep();
        } finally {
          this.isRunningWrappedStep = false;
        }

        if (!this.stepAdvancedTicksExplicitly) {
          this.currentWorld.ticks += 1;
        }

        this.expireDecayedLinks();
      };
    }

    // Mixed round+step models also assign a barrier phase. Unlike `step` it
    // never advances the tick (the autonomic `step` owns the clock), but it
    // still runs inside the wrapped-step guard so explicit tick() calls behave.
    const initialBarrierStep = this.currentWorld.barrierStep;
    if (initialBarrierStep) {
      this.currentWorld.barrierStep = () => {
        this.isRunningWrappedStep = true;
        try {
          initialBarrierStep();
        } finally {
          this.isRunningWrappedStep = false;
        }
      };
    }

    if (this.roundConfigInput) {
      this.installRoundConfig(this.roundConfigInput);
    }
  }

  /**
   * Derives field specs from the breed schemas and installs the turn state
   * machine on the world controller.
   *
   * Runs at finalize time so every breed and own schema declared anywhere in
   * the model factory is visible, regardless of statement order.
   */
  private installRoundConfig(input: RoundConfigInput) {
    const decide: Record<string, readonly RoundFieldSpec[]> = {};

    for (const [breed, fields] of Object.entries(input.decide)) {
      if (!this.turtlesByBreed.has(breed)) {
        throw new Error(`m.turn(...): "${breed}" is not a declared pet breed.`);
      }

      decide[breed] = fields.map((field) => this.deriveRoundFieldSpec(breed, field));
    }

    const findAgent = (breed: string, agentId: number) =>
      (this.turtlesByBreed.get(breed) ?? []).find((agent) => agent.id === agentId);

    this.currentWorld.configureRound({
      timeoutSeconds: input.timeoutSeconds,
      stepsPerRound: input.stepsPerRound,
      decide,
      adapter: {
        listAgentIds: (breed) =>
          (this.turtlesByBreed.get(breed) ?? []).map((agent) => agent.id),
        setDecided: (breed, agentId, decided) => {
          const agent = findAgent(breed, agentId);
          if (agent) {
            agent.decided = decided;
          }
        },
        writeFields: (breed, agentId, values) => {
          const agent = findAgent(breed, agentId);
          if (agent) {
            Object.assign(agent, values);
          }
        },
        observe: (breed, agentId) => {
          const agent = findAgent(breed, agentId);
          if (!agent) {
            return {};
          }

          // Observation = the agent's declared own fields, copied the same
          // shallow way snapshot records are built.
          const observation: Record<string, unknown> = {};
          for (const key of Object.keys(this.turtleSchemas.get(breed) ?? {})) {
            observation[key] = agent[key];
          }

          return observation;
        },
      },
    });
  }

  /**
   * Builds the validation spec for one externally decided field.
   *
   * Kind and enum membership are derived from the breed's declared own
   * fields. Schemas may declare a field either with a plain default value or
   * with field metadata (e.g. `m.editable.enum("cooperate", { options })`).
   *
   * Limitation: when an enum field is declared with a plain string default,
   * enum membership is not available at runtime (the compiler only emits the
   * default literal), so `values` is omitted and any string submission is
   * accepted for that field. Models that need strict enum validation should
   * declare the field with enum metadata.
   */
  private deriveRoundFieldSpec(breed: string, name: string): RoundFieldSpec {
    if (name === "state") {
      throw new Error(`m.turn(...): "state" cannot be decided (breed "${breed}").`);
    }

    if (name === "decided") {
      throw new Error(
        `m.turn(...): "decided" is managed by the engine and cannot be decided (breed "${breed}").`,
      );
    }

    const declared = this.turtleSchemas.get(breed)?.[name];
    if (declared === undefined) {
      throw new Error(
        `m.turn(...): "${name}" is not a declared own field of breed "${breed}".`,
      );
    }

    if (isOwnFieldMeta(declared)) {
      if (declared.type === "enum") {
        return { name, kind: "enum", values: [...(declared.options ?? [])] };
      }

      if (declared.type === "number") {
        return { name, kind: "number" };
      }

      if (declared.type === "boolean") {
        return { name, kind: "boolean" };
      }

      throw new Error(
        `m.turn(...): field "${name}" of breed "${breed}" must be enum, number, or boolean.`,
      );
    }

    if (typeof declared === "number") {
      return { name, kind: "number" };
    }

    if (typeof declared === "boolean") {
      return { name, kind: "boolean" };
    }

    if (typeof declared === "string") {
      return { name, kind: "enum" };
    }

    throw new Error(
      `m.turn(...): field "${name}" of breed "${breed}" must be enum, number, or boolean.`,
    );
  }

  /** Returns the current board configuration. */
  getBoardConfig() {
    return this.boardConfigFactory();
  }

  private readGlobalValue(key: string) {
    const readonlyField = this.globalFields.readonly[key];
    if (readonlyField?.derive) {
      return readonlyField.derive();
    }

    return this.globalValues[key];
  }

  private collectParams() {
    const params: Record<string, unknown> = {};

    for (const key of Object.keys(this.globalFields.editable)) {
      params[key] = this.globalValues[key];
    }

    for (const [key, meta] of Object.entries(this.globalFields.readonly)) {
      params[key] = meta.derive?.();
    }

    return params;
  }

  private queryBreed(
    name: string,
    ...matchers: QueryMatcher<TurtleRecord>[]
  ) {
    const query = new AgentQuery(
      () => [...(this.turtlesByBreed.get(name) ?? [])],
      this.currentWorld.random,
      {
        distanceBetween: (left, right) =>
          this.distanceBetweenPoints(left.x, left.y, right.x, right.y),
        isSame: (left, right) => left.id === right.id,
        stringMatcher: (item, matcher) => this.matchesTurtleStringMatcher(item, matcher),
      },
    );

    return matchers.length > 0 ? query.filter(...matchers) : query;
  }

  private queryLinkBreed(
    name: string,
    ...matchers: QueryMatcher<LinkRecord>[]
  ) {
    const query = new AgentQuery(
      () => [...(this.linksByBreed.get(name) ?? [])],
      this.currentWorld.random,
      {
        isSame: (left, right) => left.id === right.id,
        stringMatcher: (item, matcher) => this.matchesLinkStringMatcher(item, matcher),
      },
    );

    return matchers.length > 0 ? query.filter(...matchers) : query;
  }

  private initializePatches() {
    const minX = Math.ceil(this.currentWorld.config.minX);
    const maxX = Math.floor(this.currentWorld.config.maxX);
    const minY = Math.ceil(this.currentWorld.config.minY);
    const maxY = Math.floor(this.currentWorld.config.maxY);
    this.patchGridMinX = minX;
    this.patchGridMinY = minY;
    this.patchGridWidth = Math.max(0, maxX - minX + 1);
    this.patchGridHeight = Math.max(0, maxY - minY + 1);
    const count = this.patchGridWidth * this.patchGridHeight;

    // Built-in writable fields first, declared schema on top — mirroring the
    // old record shape where `wall` was always present ahead of the schema.
    const defaults: Record<string, unknown> = {
      color: "#fffaf0",
      label: "",
      wall: false,
      ...this.patchSchema,
    };

    this.patchColumns = new Map(
      Object.entries(defaults).map(([field, defaultValue]) => [
        field,
        makePatchColumn(defaultValue, count),
      ]),
    );

    // Column accessors live on two shared prototypes: live records read and
    // write front columns, drafts read and write back columns. One shared
    // accessor pair per field keeps property access monomorphic across all
    // patches; per-record accessors would fracture hidden classes and make
    // every field read megamorphic.
    const frontPrototype = {};
    const backPrototype = {};
    for (const [field, column] of this.patchColumns) {
      this.definePatchAccessor(frontPrototype, field, column, "front");
      this.definePatchAccessor(backPrototype, field, column, "back");
    }

    const grid: PatchRecord[] = new Array(count);
    const drafts: PatchRecord[] = new Array(count);
    for (let px = minX; px <= maxX; px += 1) {
      for (let py = minY; py <= maxY; py += 1) {
        const index = (px - minX) * this.patchGridHeight + (py - minY);
        grid[index] = this.makePatch(px, py, index, frontPrototype);
        drafts[index] = this.makePatch(px, py, index, backPrototype);
      }
    }

    this.patchGrid = grid;
    this.patchDrafts = drafts;
  }

  private makePatch(
    px: number,
    py: number,
    index: number,
    prototype: object,
  ): PatchRecord {
    const queryOptions = {
      distanceBetween: (left: PatchRecord, right: PatchRecord) =>
        this.distanceBetweenPoints(left.px, left.py, right.px, right.py),
      isSame: (left: PatchRecord, right: PatchRecord) =>
        left.px === right.px && left.py === right.py,
      stringMatcher: (item: PatchRecord, matcher: string) =>
        this.matchesPatchStringMatcher(item, matcher),
    };
    const neighborAt = (direction: PatchNeighborDirection) => {
      const offset = PATCH_NEIGHBOR_OFFSETS[direction];
      if (!offset) {
        throw new Error(`Unsupported patch neighbor direction "${direction}".`);
      }

      return this.patchAt(px + offset.dx, py + offset.dy);
    };
    const patch = Object.create(prototype) as PatchRecord;
    Object.defineProperty(patch, PATCH_INDEX, { value: index });
    Object.assign(patch, {
      px,
      py,
      neighbors4: (...matchers: QueryMatcher<PatchRecord>[]) => {
        const query = new AgentQuery(
          () =>
            [
              this.patchAt(px + 1, py),
              this.patchAt(px - 1, py),
              this.patchAt(px, py + 1),
              this.patchAt(px, py - 1),
            ].filter((value): value is PatchRecord => Boolean(value)),
          this.currentWorld.random,
          queryOptions,
        );

        return matchers.length > 0 ? query.filter(...matchers) : query;
      },
      neighbors8: (...matchers: QueryMatcher<PatchRecord>[]) => {
        const query = new AgentQuery(
          () =>
            [
              this.patchAt(px - 1, py - 1),
              this.patchAt(px, py - 1),
              this.patchAt(px + 1, py - 1),
              this.patchAt(px - 1, py),
              this.patchAt(px + 1, py),
              this.patchAt(px - 1, py + 1),
              this.patchAt(px, py + 1),
              this.patchAt(px + 1, py + 1),
            ].filter((value): value is PatchRecord => Boolean(value)),
          this.currentWorld.random,
          queryOptions,
        );

        return matchers.length > 0 ? query.filter(...matchers) : query;
      },
      neighborAt,
      neighborsAt: (...directions: PatchNeighborDirection[]) =>
        new AgentQuery(
          () =>
            directions
              .map((direction) => neighborAt(direction))
              .filter((value): value is PatchRecord => Boolean(value)),
          this.currentWorld.random,
          queryOptions,
        ),
    });

    return patch;
  }

  /**
   * Installs one shared accessor pair for a patch column on a prototype.
   *
   * Accessors resolve the record's grid index from the non-enumerable
   * {@link PATCH_INDEX} stamp, so a single getter/setter serves every patch.
   * Front-side setters refuse writes while a staged batch pass is running,
   * matching the read-only source guarantee askBatch previously enforced
   * with a proxy.
   *
   * Because the accessors are prototype properties, they are invisible to
   * own-property operations — snapshots are built explicitly from columns in
   * {@link snapshotPatches} rather than by spreading records.
   */
  private definePatchAccessor(
    prototype: object,
    field: string,
    column: PatchColumn,
    side: "front" | "back",
  ) {
    const builder = this;
    const guardFrontWrite =
      side === "front"
        ? () => {
            if (builder.patchBatchDepth > 0) {
              throw new Error(
                "askBatch source values are read-only. Write staged changes to the draft.",
              );
            }
          }
        : undefined;

    const meta = this.patchSchema[field];
    if (isRefFieldMeta(meta)) {
      const refTo = meta.to;
      Object.defineProperty(prototype, field, {
        enumerable: true,
        configurable: true,
        get(this: Record<symbol, number>) {
          const storedId = (column[side] as Float64Array)[this[PATCH_INDEX]];
          if (storedId === -1 || storedId === undefined) {
            return undefined;
          }
          if (refTo === "patch") {
            return builder.patchGrid[storedId];
          }
          const turtles = builder.turtlesByBreed.get(refTo);
          if (!turtles) return undefined;
          return turtles.find((t) => t.id === storedId);
        },
        set(this: Record<symbol, number>, val: unknown) {
          guardFrontWrite?.();
          let id = -1;
          if (val !== undefined && val !== null && val !== -1) {
            if (typeof val === "object") {
              if ("id" in val && typeof (val as any).id === "number") {
                id = (val as any).id;
              } else if ("px" in val && "py" in val) {
                const minX = Math.ceil(builder.currentWorld.config.minX);
                const maxX = Math.floor(builder.currentWorld.config.maxX);
                const minY = Math.ceil(builder.currentWorld.config.minY);
                const width = maxX - minX + 1;
                id = (Number((val as any).py) - minY) * width + (Number((val as any).px) - minX);
              }
            } else if (typeof val === "number") {
              id = val;
            }
          }
          (column[side] as Float64Array)[this[PATCH_INDEX]] = id;
        },
      });
      return;
    }

    if (column.kind === "boolean") {
      Object.defineProperty(prototype, field, {
        enumerable: true,
        configurable: true,
        get(this: Record<symbol, number>) {
          return (column[side] as Uint8Array)[this[PATCH_INDEX]] !== 0;
        },
        set(this: Record<symbol, number>, value: unknown) {
          guardFrontWrite?.();
          (column[side] as Uint8Array)[this[PATCH_INDEX]] = value ? 1 : 0;
        },
      });
      return;
    }

    Object.defineProperty(prototype, field, {
      enumerable: true,
      configurable: true,
      get(this: Record<symbol, number>) {
        return (column[side] as unknown[])[this[PATCH_INDEX]];
      },
      set(this: Record<symbol, number>, value: unknown) {
        guardFrontWrite?.();
        (column[side] as unknown[])[this[PATCH_INDEX]] = value as never;
      },
    });
  }

  /**
   * Storage-aware implementation of `askBatch` for patch queries.
   *
   * Semantics match the generic staged pass: effects read committed values
   * through the source record and stage writes on the draft; nothing an
   * effect writes is visible to other patches until the whole pass commits.
   * Here that is done with column double-buffering instead of per-patch
   * draft copies: copy front to back, run effects against pre-built draft
   * records whose accessors write the back columns, then swap.
   *
   * Unlike the generic pass, items are not shuffled first — staged effects
   * cannot observe each other, so iteration order is unobservable (per-agent
   * randomness uses order-independent salted streams). This also means a
   * staged pass no longer consumes shared RNG state.
   */
  private applyPatchBatch(
    items: PatchRecord[],
    effect: (item: PatchRecord, draft: PatchRecord) => void,
  ) {
    if (this.patchBatchDepth > 0) {
      throw new Error("Nested staged patch updates are not supported.");
    }

    for (const column of this.patchColumns.values()) {
      if (column.kind === "generic") {
        const front = column.front as unknown[];
        const back = column.back as unknown[];
        for (let i = 0; i < front.length; i += 1) {
          back[i] = front[i];
        }
      } else {
        (column.back as Float64Array).set(column.front as Float64Array);
      }
    }

    this.patchBatchDepth += 1;
    try {
      for (const item of items) {
        const index = (item as unknown as Record<symbol, number>)[PATCH_INDEX];
        effect(item, this.patchDrafts[index]);
      }
    } finally {
      this.patchBatchDepth -= 1;
    }

    // Mirror commitBatchDraft: a staged `state` change updates
    // `previousState` unless the effect staged one explicitly.
    const stateColumn = this.patchColumns.get("state");
    const previousColumn = this.patchColumns.get("previousState");
    if (stateColumn && previousColumn) {
      const stateFront = stateColumn.front as unknown[];
      const stateBack = stateColumn.back as unknown[];
      const previousFront = previousColumn.front as unknown[];
      const previousBack = previousColumn.back as unknown[];
      for (let i = 0; i < stateFront.length; i += 1) {
        if (stateBack[i] !== stateFront[i] && previousBack[i] === previousFront[i]) {
          previousBack[i] = stateFront[i];
        }
      }
    }

    for (const column of this.patchColumns.values()) {
      const front = column.front;
      column.front = column.back;
      column.back = front;
    }
  }

  private normalizePatchCoordinate(px: number, py: number) {
    const { minX, maxX, minY, maxY, topology } = this.currentWorld.config;
    const wrapX = topology === "torus" || topology === "wrap-x";
    const wrapY = topology === "torus" || topology === "wrap-y";

    const nextX = wrapX
      ? wrapCoordinate(px, minX, maxX, true)
      : px < minX || px > maxX
        ? null
        : px;
    const nextY = wrapY
      ? wrapCoordinate(py, minY, maxY, true)
      : py < minY || py > maxY
        ? null
        : py;

    if (nextX === null || nextY === null) {
      return undefined;
    }

    return { px: nextX, py: nextY };
  }

  private resetRandomState() {
    this.rng.setSeed(this.randomSeed);
    this.currentWorld.random.setSeed(this.randomSeed);
  }

  private prepareRandomStateForRun() {
    this.resetRandomState();
  }

  private agentRandomKey(agent: PatchRecord | TurtleRecord | LinkRecord | undefined) {
    if (!agent) {
      return "global";
    }

    if ("id" in agent && typeof agent.id === "number") {
      return "end1Id" in agent && "end2Id" in agent
        ? `link:${agent.id}`
        : `pet:${agent.id}`;
    }

    if ("px" in agent && "py" in agent) {
      const minX = Math.ceil(this.currentWorld.config.minX);
      const maxX = Math.floor(this.currentWorld.config.maxX);
      const minY = Math.ceil(this.currentWorld.config.minY);
      const width = maxX - minX + 1;
      const patchIndex = (Number(agent.py) - minY) * width + (Number(agent.px) - minX);
      return `patch:${patchIndex}`;
    }

    return "global";
  }

  private makeTurtle(breed: string): TurtleRecord {
    const world = this.currentWorld;
    const turtle: TurtleRecord = {
      id: this.nextTurtleId,
      x: 0,
      y: 0,
      heading: 0,
      color: "#000000",
      size: 1,
      orientable: undefined,
      shape: "default",
      hidden: false,
      label: "",
      breed,
      setRandomPosition: () => {
        turtle.x = this.randomInWorld(world.config.minX, world.config.maxX);
        turtle.y = this.randomInWorld(world.config.minY, world.config.maxY);
      },
      patchHere: () => this.patchAtPoint(turtle.x, turtle.y),
      patchAhead: (distance) => this.patchAtHeadingAndDistance(turtle, turtle.heading, distance),
      patchLeftAndAhead: (angle, distance) =>
        this.patchAtHeadingAndDistance(turtle, normalizeHeading(turtle.heading - angle), distance),
      patchRightAndAhead: (angle, distance) =>
        this.patchAtHeadingAndDistance(turtle, normalizeHeading(turtle.heading + angle), distance),
      canMove: (distance) =>
        this.patchAtHeadingAndDistance(turtle, turtle.heading, distance) !== undefined &&
        !this.traceForwardPath(turtle, distance).blocked,
      turn: (angle) => {
        turtle.heading = normalizeHeading(turtle.heading + angle);
      },
      forward: (distance) => {
        const destination = this.traceForwardPath(turtle, distance);
        turtle.x = destination.x;
        turtle.y = destination.y;
      },
      toString: () => `${breed} #${turtle.id}`,
    };

    this.nextTurtleId += 1;

    const builder = this;
    for (const [key, value] of Object.entries(this.turtleSchemas.get(breed) ?? {})) {
      if (isRefFieldMeta(value)) {
        const refTo = value.to;
        (turtle as any)[`_ref_raw_id_${key}`] = value.initialValue;
        Object.defineProperty(turtle, key, {
          enumerable: true,
          configurable: true,
          get() {
            const storedId = (turtle as any)[`_ref_raw_id_${key}`];
            if (storedId === -1 || storedId === undefined) {
              return undefined;
            }
            if (refTo === "patch") {
              return builder.patchGrid[storedId];
            }
            const turtles = builder.turtlesByBreed.get(refTo);
            if (!turtles) return undefined;
            return turtles.find((t) => t.id === storedId);
          },
          set(val: unknown) {
            let id = -1;
            if (val !== undefined && val !== null && val !== -1) {
              if (typeof val === "object") {
                if ("id" in val && typeof (val as any).id === "number") {
                  id = (val as any).id;
                } else if ("px" in val && "py" in val) {
                  const minX = Math.ceil(builder.currentWorld.config.minX);
                  const maxX = Math.floor(builder.currentWorld.config.maxX);
                  const minY = Math.ceil(builder.currentWorld.config.minY);
                  const width = maxX - minX + 1;
                  id = (Number((val as any).py) - minY) * width + (Number((val as any).px) - minX);
                }
              } else if (typeof val === "number") {
                id = val;
              }
            }
            (turtle as any)[`_ref_raw_id_${key}`] = id;
          },
        });
      } else {
        turtle[key] = isOwnFieldMeta(value) ? value.initialValue : value;
      }
    }

    return turtle;
  }

  private makeLink(
    breed: LinkBreedDefinition,
    end1: TurtleRecord,
    end2: TurtleRecord,
  ): LinkRecord {
    const link: LinkRecord = {
      id: this.nextLinkId,
      breed: breed.name,
      directed: breed.directed,
      end1Id: end1.id,
      end2Id: end2.id,
      color: "#6b7280",
      thickness: 1,
      hidden: false,
      label: "",
      refreshedTick: this.currentWorld.ticks,
      end1: () => end1,
      end2: () => end2,
      otherEnd: (pet) => {
        if (pet.id === end1.id) {
          return end2;
        }
        if (pet.id === end2.id) {
          return end1;
        }
        return undefined;
      },
      toString: () => `${breed.name} (${end1.id} -> ${end2.id})`,
    };

    this.nextLinkId += 1;

    const builder = this;
    for (const [key, value] of Object.entries(this.linkSchemas.get(breed.name) ?? {})) {
      if (isRefFieldMeta(value)) {
        const refTo = value.to;
        (link as any)[`_ref_raw_id_${key}`] = value.initialValue;
        Object.defineProperty(link, key, {
          enumerable: true,
          configurable: true,
          get() {
            const storedId = (link as any)[`_ref_raw_id_${key}`];
            if (storedId === -1 || storedId === undefined) {
              return undefined;
            }
            if (refTo === "patch") {
              return builder.patchGrid[storedId];
            }
            const turtles = builder.turtlesByBreed.get(refTo);
            if (!turtles) return undefined;
            return turtles.find((t) => t.id === storedId);
          },
          set(val: unknown) {
            let id = -1;
            if (val !== undefined && val !== null && val !== -1) {
              if (typeof val === "object") {
                if ("id" in val && typeof (val as any).id === "number") {
                  id = (val as any).id;
                } else if ("px" in val && "py" in val) {
                  const minX = Math.ceil(builder.currentWorld.config.minX);
                  const maxX = Math.floor(builder.currentWorld.config.maxX);
                  const minY = Math.ceil(builder.currentWorld.config.minY);
                  const width = maxX - minX + 1;
                  id = (Number((val as any).py) - minY) * width + (Number((val as any).px) - minX);
                }
              } else if (typeof val === "number") {
                id = val;
              }
            }
            (link as any)[`_ref_raw_id_${key}`] = id;
          },
        });
      } else {
        (link as any)[key] = isOwnFieldMeta(value) ? value.initialValue : value;
      }
    }

    return link;
  }

  private sameLinkEndpoints(
    link: LinkRecord,
    end1: TurtleRecord,
    end2: TurtleRecord,
    directed: boolean,
  ) {
    if (directed) {
      return link.end1Id === end1.id && link.end2Id === end2.id;
    }

    return (
      (link.end1Id === end1.id && link.end2Id === end2.id) ||
      (link.end1Id === end2.id && link.end2Id === end1.id)
    );
  }

  private randomInWorld(min: number, max: number) {
    return min + this.rng.float(max - min);
  }

  /**
   * Traces the straight movement path from a pet's current position.
   *
   * The path is sampled in steps of at most 0.5 world units (the final point
   * included), applying the world's topology wrapping per sample. When a
   * sample lands on a patch with `wall === true`, the move stops at the last
   * unblocked sample — or does not move at all when the first sample is
   * already blocked. `move-to` and `set-position` remain explicit teleports
   * and ignore walls.
   */
  private traceForwardPath(turtle: TurtleRecord, distance: number) {
    const { minX, maxX, minY, maxY, topology } = this.currentWorld.config;
    const wrapX = topology === "torus" || topology === "wrap-x";
    const wrapY = topology === "torus" || topology === "wrap-y";
    const vector = netLogoHeadingToVector(turtle.heading);
    const totalDistance = Number(distance);
    const sampleCount = Math.max(1, Math.ceil(Math.abs(totalDistance) / 0.5));

    let x = turtle.x;
    let y = turtle.y;
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const traveled = (totalDistance * sample) / sampleCount;
      const sampleX = wrapCoordinate(turtle.x + vector.x * traveled, minX, maxX, wrapX);
      const sampleY = wrapCoordinate(turtle.y + vector.y * traveled, minY, maxY, wrapY);

      if (this.patchAtPoint(sampleX, sampleY)?.wall === true) {
        return { x, y, blocked: true };
      }

      x = sampleX;
      y = sampleY;
    }

    return { x, y, blocked: false };
  }

  private patchAtHeadingAndDistance(
    turtle: TurtleRecord,
    heading: number,
    distance: number,
  ) {
    const vector = netLogoHeadingToVector(heading);
    return this.patchAtPoint(turtle.x + vector.x * distance, turtle.y + vector.y * distance);
  }

  private patchAtPoint(x: number, y: number) {
    const { minX, maxX, minY, maxY, topology } = this.currentWorld.config;
    const wrapX = topology === "torus" || topology === "wrap-x";
    const wrapY = topology === "torus" || topology === "wrap-y";
    const nextX = this.normalizePointCoordinate(x, minX, maxX, wrapX);
    const nextY = this.normalizePointCoordinate(y, minY, maxY, wrapY);

    if (nextX === null || nextY === null) {
      return undefined;
    }

    return this.patchAt(Math.round(nextX), Math.round(nextY));
  }

  private normalizePointCoordinate(value: number, min: number, max: number, wrap: boolean) {
    if (!wrap) {
      return value < min - 0.5 || value > max + 0.5 ? null : value;
    }

    const span = max - min + 1;
    const offset = value - (min - 0.5);
    return ((((offset % span) + span) % span) + (min - 0.5));
  }

  private distanceBetweenPoints(x1: number, y1: number, x2: number, y2: number) {
    const { minX, maxX, minY, maxY, topology } = this.currentWorld.config;
    const wrapX = topology === "torus" || topology === "wrap-x";
    const wrapY = topology === "torus" || topology === "wrap-y";
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    const dx = wrapX ? this.shortestDelta(x1, x2, spanX) : x2 - x1;
    const dy = wrapY ? this.shortestDelta(y1, y2, spanY) : y2 - y1;
    return Math.hypot(dx, dy);
  }

  private shortestDelta(start: number, end: number, span: number) {
    let delta = end - start;

    if (delta > span / 2) {
      delta -= span;
    } else if (delta < -span / 2) {
      delta += span;
    }

    return delta;
  }

  private matchesPatchStringMatcher(patch: PatchRecord, matcher: string) {
    return this.matchesStringMatcher(patch, matcher, "patch");
  }

  private matchesTurtleStringMatcher(turtle: TurtleRecord, matcher: string) {
    return this.matchesStringMatcher(turtle, matcher, "turtle");
  }

  private matchesLinkStringMatcher(link: LinkRecord, matcher: string) {
    return this.matchesStringMatcher(link, matcher, "link");
  }

  private matchesStringMatcher(
    agent: PatchRecord | TurtleRecord | LinkRecord,
    matcher: string,
    defaultKind: "patch" | "turtle" | "link",
  ) {
    if (this.isLegacyStateMatcher(agent, matcher)) {
      return true;
    }

    try {
      return matchesAgentSelector(agent, matcher, { defaultKind });
    } catch {
      return false;
    }
  }

  private isLegacyStateMatcher(
    agent: PatchRecord | TurtleRecord | LinkRecord,
    matcher: string,
  ) {
    const candidate = agent as PatchRecord & TurtleRecord & {
      state?: unknown;
      status?: unknown;
    };
    return candidate.state === matcher || candidate.status === matcher;
  }
}
