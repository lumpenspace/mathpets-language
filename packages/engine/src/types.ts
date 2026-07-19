/**
 * Engine core types.
 *
 * This file holds the small, stable structural types that the rest of the
 * engine builds on: world bounds, topology, minimal turtle geometry, and
 * sparse state styling.
 */

/**
 * Supported world boundary behaviors.
 *
 * - `torus`: wrap on both axes.
 * - `box`: clamp on both axes.
 * - `wrap-x`: wrap horizontally and clamp vertically.
 * - `wrap-y`: clamp horizontally and wrap vertically.
 */
export type WorldTopology = "torus" | "box" | "wrap-x" | "wrap-y";

/**
 * Current execution state of a world controller.
 *
 * `idle` means the world has not been started yet, `ready` means setup has run
 * and the world is prepared for stepping, `running` is the active simulation
 * state, `paused` suspends stepping without resetting state, and `finished`
 * indicates the model has reached its end condition or was explicitly ended.
 */
export type WorldStatus = "idle" | "ready" | "running" | "paused" | "finished";

/**
 * Inclusive world bounds used for patch generation and turtle movement.
 */
export interface WorldConfig {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  topology: WorldTopology;
}

/**
 * Minimal turtle geometry used by query helpers and movement utilities.
 */
export interface TurtleLike {
  id: number;
  x: number;
  y: number;
  heading: number;
}

/**
 * Mutable presentation state for a patch, turtle, or state transition.
 *
 * Fields are intentionally sparse so callers can override only the aspects they
 * care about. `transition` is the number of ticks used to interpolate from the
 * previous state style into this one after an item changes state.
 */
export interface StateStyle {
  color?: string;
  size?: number;
  orientable?: boolean;
  shape?: string;
  hidden?: boolean;
  label?: string;
  transition?: number;
}
