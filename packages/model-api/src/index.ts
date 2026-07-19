/**
 * Public barrel for the model authoring API.
 *
 * The package is organized by concern so worlds, agents, fields, presentation,
 * and model-definition entry points each live in focused files while consumers
 * continue to import everything from one stable module.
 */
export * from "./agents";
export * from "./define-model";
export type {
  AgentMessage,
  AgentRef,
  ChannelMessage,
  DecisionExtras,
  DecisionRequest,
  DecisionSchemaOptions,
  JsonSchema,
  SubmitDecisionResult,
  RoundAgentAdapter,
  RoundFieldSpec,
  RoundSnapshot,
  RoundTranscriptEntry,
  WorldRoundConfig,
} from "@pets/engine";
export {
  agentRefKey,
  decisionRequestSchema,
  decisionResponseSchema,
  parseAgentRefKey,
} from "@pets/engine";
export * from "./fields";
export * from "./model-definition";
export * from "./presentation";
export * from "./selectors";
