/**
 * Public model surface exposed to the app and renderers.
 *
 * A model definition packages the live world controller with metadata, state
 * registries, snapshots, and board configuration. Consumers never need the
 * builder internals directly.
 */
import type { WorldController } from "@pets/engine";
import type { ModelGlobals, ModelParams, ModelSnapshot, StateRegistry, WorldView } from "./agents";
import type { ModelBoardConfig } from "./presentation";

/**
 * Public model definition returned by `defineModel`.
 *
 * Consumers read the world, params, and state registries from this object and
 * use the helper methods to retrieve snapshots and board settings.
 */
export interface ModelDefinition {
  /** The live world controller backing the model. */
  world: WorldController;
  /** Param field metadata and accessors. */
  params: ModelParams;
  /** Alias for {@link params}. */
  globals: ModelGlobals;
  /** State registries for patches and breeds. */
  states: StateRegistry;
  /** Optional draw callback used by the UI layer. */
  draw?: (view: WorldView) => void;
  /** Returns the current board configuration. */
  getBoardConfig(): ModelBoardConfig;
  /** Returns a revision-aware snapshot for client rendering. */
  getSnapshot(): ModelSnapshot;
  /** Returns a stable snapshot for server-side rendering. */
  getServerSnapshot(): ModelSnapshot;
  /** Returns the seed used for deterministic model randomness. */
  getRandomSeed(): number;
  /** Returns true when the model seed is pinned across setup runs. */
  isRandomSeedPinned(): boolean;
  /** Updates the deterministic random seed. */
  setRandomSeed(seed: number | string, options?: { pinned?: boolean }): void;
  /** Returns to the default behavior of choosing a fresh seed for each setup run. */
  clearRandomSeed(): void;
  /** Updates an editable param value. */
  setParamValue(key: string, value: unknown): void;
  /** Alias for {@link setParamValue}. */
  setGlobalValue(key: string, value: unknown): void;
  /**
   * Stamps `wall = true` on patches matching `#` characters in `rows`.
   *
   * Rows are top-to-bottom (first row = highest `py`), centered on the world
   * unless `centerX`/`centerY` are given; out-of-world cells are clipped.
   * Emits a world change.
   */
  applyWallMap(rows: string[], options?: { centerX?: number; centerY?: number }): void;
  /**
   * Registers a wall map that persists across restarts: it is stamped
   * immediately (replacing existing walls) and re-stamped after every reset.
   * Pass `null` to unregister and clear all walls.
   */
  setWallMap(rows: string[] | null, options?: { centerX?: number; centerY?: number }): void;
  /** Clears the `wall` flag on every patch and emits a world change. */
  clearWalls(): void;
  /** True when the model declares a `brush:` section. */
  hasBrush: boolean;
  /**
   * Runs the model's `brush:` statements against the patch at `(px, py)`,
   * then emits a world change. Undefined when the model has no brush section.
   */
  applyBrush?: (px: number, py: number) => void;
  /** Clears runtime state and reruns setup, leaving the world ready. */
  restart(): void;
}
