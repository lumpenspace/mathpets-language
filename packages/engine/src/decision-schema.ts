/**
 * Compiles decision requests into JSON Schemas for structured host input.
 *
 * A turn-based agent must answer with values for its decided fields and may
 * use the protocol channels (say, memory, direct messages). This module rounds
 * the field specs of a `DecisionRequest` into a JSON Schema so hosts can ask
 * any external decision source for a response that validates against the same rules
 * `world.submitDecision` enforces — no prose parsing, no invalid moves.
 */
import { AgentRef, DecisionRequest, RoundFieldSpec } from "./round";

/** A JSON Schema fragment consumed by interactive or network hosts. */
export type JsonSchema = Record<string, unknown>;

/** Options shaping which protocol channels the response schema offers. */
export interface DecisionSchemaOptions {
  /** Offer the optional `say` public-channel utterance (default true). */
  say?: boolean;
  /** Offer the optional `memory` private-notes property (default true). */
  memory?: boolean;
  /** Offer the optional `note`-to-the-modeler property (default false). */
  note?: boolean;
  /**
   * Peers the agent may message this turn. When non-empty, the schema offers
   * an optional `messages` array of `{ to, text }` where `to` is constrained
   * to these peers (encoded `breed:agentId`).
   */
  peers?: readonly AgentRef[];
}

/** Encodes an agent reference the way peer enums and history keys use it. */
export function agentRefKey(ref: AgentRef): string {
  return `${ref.breed}:${ref.agentId}`;
}

/** Parses a `breed:agentId` key back into an agent reference. */
export function parseAgentRefKey(key: string): AgentRef | null {
  const match = /^(.+):(-?\d+)$/.exec(key);
  if (!match) {
    return null;
  }

  return { breed: match[1], agentId: Number(match[2]) };
}

function fieldSchema(field: RoundFieldSpec): JsonSchema {
  if (field.kind === "number") {
    return { type: "number", description: `Decided value for "${field.name}".` };
  }

  if (field.kind === "boolean") {
    return { type: "boolean", description: `Decided value for "${field.name}".` };
  }

  const schema: JsonSchema = {
    type: "string",
    description: `Decided value for "${field.name}".`,
  };

  // Enum membership may be unavailable at runtime (plain string default in
  // the breed schema); mirror the engine's validation and accept any string.
  if (field.values && field.values.length > 0) {
    schema.enum = [...field.values];
  }

  return schema;
}

/**
 * Builds the JSON Schema an external response must satisfy to conclude a turn.
 *
 * The decided fields are required; the protocol channels are optional. The
 * schema is self-contained and transport-agnostic.
 */
export function decisionResponseSchema(
  fields: readonly RoundFieldSpec[],
  options: DecisionSchemaOptions = {},
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const field of fields) {
    properties[field.name] = fieldSchema(field);
    required.push(field.name);
  }

  if (options.say !== false) {
    properties.say = {
      type: "string",
      description:
        "Optional short remark broadcast on the public channel, visible to every agent.",
    };
  }

  if (options.memory !== false) {
    properties.memory = {
      type: "string",
      description:
        "Optional private notes handed back verbatim on your next turn. Use them to remember plans, promises, and what you learned.",
    };
  }

  if (options.note === true) {
    properties.note = {
      type: "string",
      description: "Optional note to the modeler; never shown to other agents.",
    };
  }

  const peers = options.peers ?? [];
  if (peers.length > 0) {
    properties.messages = {
      type: "array",
      description:
        "Optional direct messages to other agents, delivered before your decision concludes the turn.",
      items: {
        type: "object",
        properties: {
          to: {
            type: "string",
            enum: peers.map(agentRefKey),
            description: "Recipient, encoded breed:agentId.",
          },
          text: { type: "string", description: "Message text." },
        },
        required: ["to", "text"],
        additionalProperties: false,
      },
    };
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * Convenience: the response schema for one pending decision request, offering
 * exactly the channels the request supports (messages to its live peers).
 */
export function decisionRequestSchema(
  request: DecisionRequest,
  options: Omit<DecisionSchemaOptions, "peers"> = {},
): JsonSchema {
  return decisionResponseSchema(request.fields, { ...options, peers: request.peers });
}
