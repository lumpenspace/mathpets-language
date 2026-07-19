export interface PetsModel {
  name: string;
  defs: PetsDef[];
  world: PetsWorld;
  params: PetsParam[];
  memory: PetsMemoryField[];
  monitors: PetsMonitor[];
  patches: PetsPatchField[];
  zones: PetsZoneBreed[];
  petActions: PetsActionDef[];
  pets: PetsPetBreed[];
  links: PetsLinkBreed[];
  setup: PetsStatement[];
  steps: PetsStep[];
  /**
   * Turn-based sections (`turn <seconds>:`, `turn:`, `turn staged:`,
   * `turn async:`). Mutually exclusive with `steps`; empty/absent for
   * step-based models.
   */
  rounds?: PetsRoundSection[];
  /**
   * Patch statements compiled from the optional `brush:` section. They run
   * against the single patch the user clicks, between ticks.
   */
  brush?: PetsAgentAction[];
  stop?: PetsExpression;
}

export interface PetsDef {
  name: string;
  params: PetsDefParam[];
  returnType: PetsType;
  statements: PetsDefStatement[];
}

export interface PetsDefParam {
  name: string;
  type: PetsType;
}

export type PetsDefStatement =
  | PetsLetStatement
  | PetsReturnStatement
  | PetsExpressionStatement;

export interface PetsLetStatement {
  kind: "let";
  name: string;
  type?: PetsType;
  expression: PetsExpression;
}

export interface PetsReturnStatement {
  kind: "return";
  expression: PetsExpression;
}

export interface PetsExpressionStatement {
  kind: "expression";
  expression: PetsExpression;
}

export interface PetsWorld {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  topology: "torus" | "box" | "wrap-x" | "wrap-y";
}

export interface PetsParam {
  name: string;
  type: PetsType;
  control: PetsControl;
}

export interface PetsMemoryField {
  name: string;
  type: PetsType;
  initialValue: PetsExpression;
}

export interface PetsPatchField {
  name: string;
  type: PetsType;
  initialValue: string | number | boolean | string[] | number[];
  states?: string[];
}

export interface PetsZoneBreed {
  name: string;
  size: number;
  fields: PetsZoneField[];
}

export interface PetsZoneField {
  name: string;
  type: PetsType;
  initialValue: string | number | boolean | string[] | number[];
  states?: string[];
}

export interface PetsPetBreed {
  name: string;
  /**
   * Player breeds (declared `player <name>:`) are pets that take rounds:
   * externally driven participants in a turn-based
   * model. They are ordinary pets in every other respect — position,
   * heading, movement, queries — plus the right to `decide` fields and the
   * implicit turn-protocol state. Plain pet breeds cannot `decide`.
   */
  isPlayer: boolean;
  fields: PetsPetField[];
  actions: PetsActionDef[];
}

export interface PetsLinkBreed {
  name: string;
  directed: boolean;
  /**
   * Ticks a link survives after creation or its last refresh; re-creating an
   * existing link refreshes it. Absent means links never age.
   */
  decay?: number;
  fields: PetsLinkField[];
}

export interface PetsPetField {
  name: string;
  type: PetsType;
  initialValue: string | number | boolean | string[] | number[];
  states?: string[];
}

export interface PetsLinkField {
  name: string;
  type: PetsType;
  initialValue: string | number | boolean | string[] | number[];
  states?: string[];
}

export type PetsType =
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "string" }
  | { kind: "enum"; values: string[] }
  | { kind: "set"; element: PetsSetElementType }
  | { kind: "ref"; to: string };

export type PetsSetElementType =
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "enum"; values: string[] };

export type PetsControl =
  | { kind: "slider"; value: number; min: number; max: number; step?: number }
  | { kind: "toggle"; value: boolean }
  | { kind: "select"; value: string; options: string[] }
  | { kind: "literal"; value: string | number | boolean };

export interface PetsMonitor {
  name: string;
  type: PetsType;
  expression: PetsExpression;
}

export interface PetsStep {
  staged: boolean;
  statements: PetsStatement[];
}

export interface PetsRoundSection {
  mode: "plain" | "staged" | "async";
  /** Decision deadline in seconds; carried by exactly one turn section. */
  deadline?: number;
  statements: PetsStatement[];
}

export type PetsStatement =
  | PetsUpdateStatement
  | PetsCreateStatement
  | PetsRepeatStatement
  | PetsAssignment
  | PetsCommandStatement;

export type PetsAgentAction =
  | PetsAssignment
  | PetsCommandStatement
  | PetsLetStatement
  | PetsRepeatAction
  | PetsWhereBlock
  | PetsActionCall
  | PetsDecideStatement;

/**
 * `decide <field>[, <field>…]` — only valid directly inside a breed block of
 * a non-async `turn` section. Declares the breed's fields decided externally
 * each turn.
 */
export interface PetsDecideStatement {
  kind: "decide";
  fields: string[];
}

export interface PetsActionDef {
  name: string;
  params: PetsDefParam[];
  body: PetsAgentAction[];
}

export interface PetsActionCall {
  kind: "action-call";
  name: string;
  args?: PetsExpression[];
  hasParens?: boolean;
}

export interface PetsWhereBlock {
  kind: "where";
  condition: PetsExpression;
  body: PetsAgentAction[];
  otherwiseBody?: PetsAgentAction[];
}

export interface PetsRepeatStatement {
  kind: "repeat";
  count?: PetsExpression;
  index?: string;
  rangeStart?: PetsExpression;
  rangeEnd?: PetsExpression;
  body: PetsStatement[];
}

export interface PetsRepeatAction {
  kind: "repeat";
  count?: PetsExpression;
  index?: string;
  rangeStart?: PetsExpression;
  rangeEnd?: PetsExpression;
  body: PetsAgentAction[];
}

export interface PetsUpdateStatement {
  kind: "update";
  agentSet: string;
  where?: PetsExpression;
  body: PetsAgentAction[];
}

export interface PetsCreateStatement {
  kind: "create";
  breed: string;
  count: PetsExpression;
  body?: PetsAgentAction[];
}

export interface PetsCommandStatement {
  kind: "command";
  command:
    | "forward"
    | "turn"
    | "face"
    | "set-random-position"
    | "set-position"
    | "move-to"
    | "diffuse"
    | "die"
    | "hatch"
    | "kill"
    | "kill-one"
    | "create-link-with"
    | "create-link-to"
    | "die-link"
    | "turn-towards"
    | "turn-away"
    | "follow-patch-gradient"
    | "scatter";
  /**
   * For `scatter`: [spread] places around the agent itself, [spread, anchor]
   * around another agent or patch, [spread, x, y] around a point.
   */
  args: PetsExpression[];
  /**
   * For `diffuse(field, amount) over <breed>`: the link breed to diffuse the
   * field across, instead of the patch grid. Only valid on `diffuse`.
   */
  overBreed?: string;
}

export interface PetsAssignment {
  kind: "assignment";
  target: string;
  expression: PetsExpression;
}

export interface PetsExpression {
  source: string;
}

export interface PetsDiagnostic {
  message: string;
  from: number;
  to: number;
}

export interface PetsParseResult {
  model: PetsModel | null;
  diagnostics: PetsDiagnostic[];
}
