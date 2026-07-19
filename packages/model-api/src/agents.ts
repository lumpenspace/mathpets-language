/**
 * Agent-facing public types shared across model definitions and snapshots.
 *
 * These interfaces describe the serializable patch/pet records, breed query
 * handles, and snapshot/state registries consumed by the UI and examples.
 */
import type { AgentQuery, StateStyle, RoundSnapshot, WorldController } from "@pets/engine";
import type { FieldMeta } from "./fields";

/**
 * Query matcher accepted by agent queries.
 *
 * String matchers support both the legacy `state`/`status` shorthand such as
 * `"burning"` and selector-style expressions such as `patch:burning` or
 * `pet.wolves:hunting` or the legacy `turtle.wolves:hunting`.
 */
export type QueryMatcher<T> = ((item: T) => boolean) | Partial<T> | string;

export type PatchNeighborDirection =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

/** Optional transition bookkeeping carried only by models that opt into it. */
export interface TransitionStateRecord {
  /** Previous state recorded during an explicit state transition. */
  previousState?: string;
}

/** Minimal world-view surface exposed to drawing callbacks. */
export interface WorldView {
  /** Highlights a patch in the current view. */
  highlightPatch(x: number, y: number, color: string): void;
}

/**
 * Serializable patch record returned in model snapshots.
 *
 * The runtime patch object may also carry user-defined fields and query helpers.
 */
export interface PatchRecord {
  px: number;
  py: number;
  color: string;
  label: string;
  /**
   * Built-in wall flag (default `false`).
   *
   * Wall patches block pet movement paths and are isolated from
   * diffusion. The field is writable from Pets code without being
   * declared in `patches:`.
   */
  wall: boolean;
  /** Current patch state, if the patch has been assigned one. */
  state?: string | number;
  /** Returns the 4-neighborhood of this patch. */
  neighbors4(): AgentQuery<PatchRecord>;
  /** Returns the 4-neighborhood of this patch, optionally filtered. */
  neighbors4(...matchers: QueryMatcher<PatchRecord>[]): AgentQuery<PatchRecord>;
  /** Returns the 8-neighborhood of this patch. */
  neighbors8(): AgentQuery<PatchRecord>;
  /** Returns the 8-neighborhood of this patch, optionally filtered. */
  neighbors8(...matchers: QueryMatcher<PatchRecord>[]): AgentQuery<PatchRecord>;
  /** Returns a single neighboring patch by relative direction. */
  neighborAt(direction: PatchNeighborDirection): PatchRecord | undefined;
  /** Returns selected neighboring patches in the requested direction order. */
  neighborsAt(...directions: PatchNeighborDirection[]): AgentQuery<PatchRecord>;
  [key: string]: unknown;
}

/**
 * Serializable pet record returned in model snapshots.
 *
 * The runtime pet object also exposes movement helpers and custom fields.
 */
export interface TurtleRecord {
  id: number;
  x: number;
  y: number;
  heading: number;
  color: string;
  size: number;
  orientable?: boolean;
  shape: string;
  hidden: boolean;
  label: string;
  breed: string;
  /** Current pet state, if one has been assigned. */
  state?: string | number;
  /** Places the pet at a random position within the current world bounds. */
  setRandomPosition(): void;
  /** Returns the patch under the pet, or `undefined` if none exists. */
  patchHere(): PatchRecord | undefined;
  /** Returns the patch some distance ahead of the pet, if any. */
  patchAhead(distance: number): PatchRecord | undefined;
  /** Returns the patch to the pet's left and ahead, if any. */
  patchLeftAndAhead(angle: number, distance: number): PatchRecord | undefined;
  /** Returns the patch to the pet's right and ahead, if any. */
  patchRightAndAhead(angle: number, distance: number): PatchRecord | undefined;
  /** Returns `true` when moving forward by `distance` would stay on the world. */
  canMove(distance: number): boolean;
  /** Turns the pet by `angle` degrees. */
  turn(angle: number): void;
  /** Moves the pet forward by `distance`, applying world topology rules. */
  forward(distance: number): void;
  [key: string]: unknown;
}

/** Source-language alias for {@link TurtleRecord}. */
export type PetRecord = TurtleRecord;

/**
 * Serializable link record returned in model snapshots.
 *
 * Runtime links also expose endpoint helpers, but snapshots carry stable
 * endpoint ids so renderers can join links to the current pet snapshot.
 */
export interface LinkRecord {
  id: number;
  breed: string;
  directed: boolean;
  end1Id: number;
  end2Id: number;
  color: string;
  thickness: number;
  hidden: boolean;
  label: string;
  /** Tick this link was created or last re-created; drives breed decay. */
  refreshedTick: number;
  /** Current link state, if one has been assigned. */
  state?: string | number;
  /** Returns the first endpoint pet. */
  end1(): TurtleRecord;
  /** Returns the second endpoint pet. */
  end2(): TurtleRecord;
  /** Returns the opposite endpoint for an incident pet. */
  otherEnd(pet: TurtleRecord): TurtleRecord | undefined;
  [key: string]: unknown;
}

/** Describes a breed that can own pets and expose breed-scoped queries. */
export interface BreedDefinition {
  name: string;
  /** Declares the breed's custom schema. */
  own(schema: Record<string, unknown>): void;
  /** Returns all pets in the breed, optionally filtered. */
  all(): AgentQuery<TurtleRecord>;
  /** Returns all pets in the breed, optionally filtered. */
  all(...matchers: QueryMatcher<TurtleRecord>[]): AgentQuery<TurtleRecord>;
  /** Alias for {@link all} that emphasizes query composition. */
  filter(...matchers: QueryMatcher<TurtleRecord>[]): AgentQuery<TurtleRecord>;
}

/** Describes a breed that can own links and expose breed-scoped queries. */
export interface LinkBreedDefinition {
  name: string;
  directed: boolean;
  /**
   * Ticks a link survives after creation or its last refresh; re-creating an
   * existing link refreshes it. Absent means links never age.
   */
  decay?: number;
  /** Declares the link breed's custom schema. */
  own(schema: Record<string, unknown>): void;
  /** Returns all links in the breed, optionally filtered. */
  all(): AgentQuery<LinkRecord>;
  /** Returns all links in the breed, optionally filtered. */
  all(...matchers: QueryMatcher<LinkRecord>[]): AgentQuery<LinkRecord>;
  /** Alias for {@link all} that emphasizes query composition. */
  filter(...matchers: QueryMatcher<LinkRecord>[]): AgentQuery<LinkRecord>;
}

/**
 * Registry of state names to styles, split by patches and breeds.
 *
 * Separate registries let a patch state and a breed state reuse the same name
 * while still resolving to different styles.
 */
export interface StateRegistry {
  /** Patch state styles keyed by state name. */
  patches: Record<string, StateStyle>;
  /** Breed state styles keyed first by breed name and then by state name. */
  breeds: Record<string, Record<string, StateStyle>>;
  /** Link state styles keyed first by link breed name and then by state name. */
  links: Record<string, Record<string, StateStyle>>;
}

/**
 * Accepted state declarations when registering patch or breed states.
 *
 * Passing an array creates empty entries. Passing a record supplies explicit
 * styles per state.
 */
export type StateDefinitions = readonly string[] | Record<string, StateStyle>;

/** Catalog of editable and readonly params. */
export interface ModelGlobals {
  editable: Record<string, FieldMeta>;
  readonly: Record<string, FieldMeta>;
}

/** Source-language name for editable and readonly model-level fields. */
export type ModelParams = ModelGlobals;

/**
 * Snapshot of the current model state for rendering and hydration.
 *
 * Patch and pet arrays are shallow copies, so object identity is not stable
 * across snapshot recomputation.
 */
export interface ModelSnapshot {
  /** Number of elapsed simulation ticks. */
  ticks: number;
  /** Seed used for deterministic random values in the current run. */
  randomSeed: number;
  /** Whether the seed is pinned instead of regenerated for each setup run. */
  randomSeedPinned: boolean;
  /** Current world status at snapshot time. */
  status: ReturnType<WorldController["status"]>;
  /** Current global values, including derived readonly values. */
  globals: Record<string, unknown>;
  /** Current param values, including derived readonly values. */
  params: Record<string, unknown>;
  /**
   * Turn progress for round-based models (see docs/round-based-models.md).
   *
   * Absent for ordinary `step:` models.
   */
  round?: RoundSnapshot;
  /** Shallow copies of all patches in the world. */
  patches: PatchRecord[];
  /** Shallow copies of all pets in the world. */
  turtles: TurtleRecord[];
  /** Shallow copies of all links in the world. */
  links: LinkRecord[];
}
