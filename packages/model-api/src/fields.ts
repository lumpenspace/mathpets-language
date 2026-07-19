/**
 * Field metadata primitives for model params.
 *
 * These types describe editable and readonly params without coupling the model
 * layer to any specific UI. The React app reads these hints to build controls
 * and labels, while the engine only cares about values and derivations.
 */
type ControlHint = "slider" | "input" | "toggle" | "select";
type ApplyMode = "live" | "setup";

interface FieldMetaBase {
  label?: string;
  control?: ControlHint;
  apply?: ApplyMode;
}

interface NumberFieldMetaBase extends FieldMetaBase {
  min?: number;
  max?: number;
  step?: number;
  options?: never;
}

export type ReadonlyNumberDisplay =
  | {
      style?: "value";
      fractionDigits?: number;
      minValue?: never;
      maxValue?: never;
      startColor?: never;
      endColor?: never;
      neutralColor?: never;
      history?: never;
      color?: never;
      group?: never;
      groupLabel?: never;
    }
  | {
      style: "color-scale";
      fractionDigits?: number;
      minValue?: number;
      maxValue?: number;
      startColor?: string;
      endColor?: string;
      neutralColor?: string;
      history?: never;
      color?: never;
      group?: never;
      groupLabel?: never;
    }
  | {
      style: "line-graph";
      fractionDigits?: number;
      minValue?: number;
      maxValue?: number;
      history?: number;
      color?: string;
      group?: string;
      groupLabel?: string;
      startColor?: never;
      endColor?: never;
      neutralColor?: never;
    };

interface BooleanFieldMetaBase extends FieldMetaBase {
  min?: never;
  max?: never;
  step?: never;
  options?: never;
}

interface EnumFieldMetaBase extends FieldMetaBase {
  options: readonly string[];
  min?: never;
  max?: never;
  step?: never;
}

export function deriveFieldLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Metadata for a mutable numeric param.
 *
 * The `initialValue` seeds model state. Optional UI hints guide how a UI should
 * render and apply the field.
 */
export interface EditableNumberFieldMeta extends NumberFieldMetaBase {
  kind: "editable";
  type: "number";
  initialValue: number;
  derive?: never;
}

/** Metadata for a computed numeric param. */
export interface ReadonlyNumberFieldMeta extends NumberFieldMetaBase {
  kind: "readonly";
  type: "number";
  derive: () => number;
  display?: ReadonlyNumberDisplay;
  initialValue?: never;
}

/** Metadata for a mutable boolean param. */
export interface EditableBooleanFieldMeta extends BooleanFieldMetaBase {
  kind: "editable";
  type: "boolean";
  initialValue: boolean;
  derive?: never;
}

/** Metadata for a computed boolean param. */
export interface ReadonlyBooleanFieldMeta extends BooleanFieldMetaBase {
  kind: "readonly";
  type: "boolean";
  derive: () => boolean;
  initialValue?: never;
}

/** Metadata for a mutable enumerated param. */
export interface EditableEnumFieldMeta extends EnumFieldMetaBase {
  kind: "editable";
  type: "enum";
  initialValue: string;
  derive?: never;
}

/** Metadata for a computed enumerated param. */
export interface ReadonlyEnumFieldMeta extends EnumFieldMetaBase {
  kind: "readonly";
  type: "enum";
  derive: () => string;
  initialValue?: never;
}

/**
 * Union of all supported field metadata variants.
 *
 * Editable fields store an initial value. Readonly fields expose a `derive`
 * function that is invoked on read.
 */
export type FieldMeta =
  | EditableNumberFieldMeta
  | ReadonlyNumberFieldMeta
  | EditableBooleanFieldMeta
  | ReadonlyBooleanFieldMeta
  | EditableEnumFieldMeta
  | ReadonlyEnumFieldMeta;
