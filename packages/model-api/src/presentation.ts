/**
 * Presentation-layer types for boards and style sheets.
 *
 * These definitions keep appearance separate from model semantics so renderers,
 * authoring tools, and style sheets can evolve without changing simulation code.
 */
import type { StateStyle } from "@pets/engine";
import type { LinkRecord, PatchRecord, TurtleRecord } from "./agents";
import type { ReadonlyNumberDisplay } from "./fields";

/** Visual configuration for a board or canvas surface. */
export interface ModelBoardConfig {
  cellPixels?: number;
  showGrid?: boolean;
}

/** Alias used by presentation resolvers and style sheets. */
export type PresentationStyle = StateStyle;

/** Built-in continuous color scales available to declarative stylesheets. */
export type PresentationColorScaleName =
  | "viridis"
  | "inferno"
  | "magma"
  | "plasma"
  | "cividis"
  | "turbo"
  | "warm"
  | "cool"
  | "cubehelix"
  | "rainbow"
  | "sinebow";

/** Maps a numeric field to a color using a built-in D3 scale or a custom range. */
export interface PresentationColorScale {
  scale?: PresentationColorScaleName;
  domain?: number[];
  range?: string[];
  clamp?: boolean;
  unknown?: string;
}

/** Styles derived from a numeric patch field. */
export interface PresentationFieldStylesheet {
  color?: PresentationColorScale;
}

/** CSS-like selector rule applied against patches or pets. */
export interface PresentationRule {
  /** Selector such as `patch:burning` or `pet.wolves:hunting`. */
  selector: string;
  /** Style payload applied when the selector matches. */
  style: PresentationStyle;
}

/**
 * Optional runtime resolvers that map live patches and pets to styles.
 */
export interface PresentationResolvers {
  patchStyle?: (patch: PatchRecord) => PresentationStyle | undefined;
  turtleStyle?: (turtle: TurtleRecord) => PresentationStyle | undefined;
  linkStyle?: (link: LinkRecord) => PresentationStyle | undefined;
}

/** Styles applied when a patch has no explicit state style. */
export interface PresentationPatchStylesheet {
  /** Default style when a patch has no matching state style. */
  default?: PresentationStyle;
  /** State-specific styles keyed by patch state. */
  states?: Record<string, PresentationStyle>;
  /** Field-driven styles for continuous patch values. */
  fields?: Record<string, PresentationFieldStylesheet>;
}

/** Styles applied when a breed has no explicit state style. */
export interface PresentationBreedStylesheet {
  /** Default style when a breed has no matching state style. */
  default?: PresentationStyle;
  /** State-specific styles keyed by breed state. */
  states?: Record<string, PresentationStyle>;
  /** Field-driven styles for continuous pet values. */
  fields?: Record<string, PresentationFieldStylesheet>;
  /** Limits the shape picker to orientable, non-orientable, or all icons. */
  shapeMode?: "both" | "orientable" | "non-orientable";
}

/** Styles applied when a link breed has no explicit state style. */
export interface PresentationLinkStylesheet {
  /** Default style when a link has no matching state style. */
  default?: PresentationStyle;
  /** State-specific styles keyed by link state. */
  states?: Record<string, PresentationStyle>;
}

/** Styles applied to readonly monitor widgets. */
export interface PresentationMonitorStylesheet {
  /** Optional override for the monitor label shown in the UI. */
  label?: string;
  /** Optional display/plotting behavior for numeric monitors. */
  display?: ReadonlyNumberDisplay;
}

/** Complete declarative stylesheet for patches and breeds. */
export interface PresentationStylesheet {
  /** Patches styles keyed by patch group. */
  patches?: PresentationPatchStylesheet;
  /** Breed styles keyed by breed name. */
  breeds?: Record<string, PresentationBreedStylesheet>;
  /** Link styles keyed by link breed name. */
  links?: Record<string, PresentationLinkStylesheet>;
  /** Monitor styles keyed by readonly param field name. */
  monitors?: Record<string, PresentationMonitorStylesheet>;
  /** Selector-driven rules applied after structural patch/breed styles. */
  rules?: PresentationRule[];
}
