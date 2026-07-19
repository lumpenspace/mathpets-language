/**
 * Round-based model runtime types.
 *
 * Round-based models (see docs/round-based-models.md) advance in discrete rounds:
 * designated agent fields are decided externally and asynchronously, and the
 * world only advances its tick once every decision arrived or the per-round
 * deadline passed. These types describe the contract between the engine's
 * round state machine, the model API that configures it, and hosts that
 * resolve decisions.
 */

/** Describes one externally decided field of a deciding breed. */
export interface RoundFieldSpec {
  /** camelCase record key on the agent. */
  name: string;
  /** Value kind used for validation of submitted decisions. */
  kind: "enum" | "number" | "boolean";
  /**
   * Enum members, when `kind === "enum"`.
   *
   * May be absent when enum membership metadata is not available at runtime
   * (e.g. the field was declared with a plain string default); in that case
   * any string value is accepted.
   */
  values?: readonly string[];
}

/** Addresses one agent of a deciding breed. */
export interface AgentRef {
  breed: string;
  agentId: number;
}

/** A direct message between agents (the conversation channel). */
export interface AgentMessage {
  /** Monotonic sequence shared with the transcript, unique per controller. */
  seq: number;
  /** Turn (the tick it will produce) the message was sent in. */
  round: number;
  from: AgentRef;
  to: AgentRef;
  text: string;
  /** Epoch ms. */
  at: number;
}

/** A public-channel utterance, said alongside a decision. */
export interface ChannelMessage {
  /** Monotonic sequence shared with the transcript, unique per controller. */
  seq: number;
  /** Turn the utterance was made in. */
  round: number;
  from: AgentRef;
  text: string;
  /** Epoch ms. */
  at: number;
}

/**
 * Optional protocol payload accompanying a decision submission.
 *
 * Every field is recorded in the turn transcript so externally driven
 * externally driven behavior stays visible and inspectable.
 */
export interface DecisionExtras {
  /** Utterance broadcast on the public channel. */
  say?: string;
  /** Note addressed to the modeler (never shown to other agents). */
  note?: string;
  /** Replaces the agent's private memory, handed back on its next request. */
  memory?: string;
}

/**
 * One inspectable event in the bounded turn transcript.
 *
 * `decision` entries carry the accepted values plus any extras; `message`
 * entries mirror direct agent-to-agent messages; `timeout` entries are
 * recorded at finalize for every agent whose decision never arrived.
 */
export interface RoundTranscriptEntry {
  /** Monotonic sequence, unique per controller lifetime. */
  seq: number;
  kind: "decision" | "message" | "timeout";
  /** Turn (the tick it produced/will produce) the event belongs to. */
  round: number;
  /** Acting agent. */
  breed: string;
  agentId: number;
  /** Message recipient (kind `message`). */
  to?: AgentRef;
  /** Message text (kind `message`). */
  text?: string;
  /** Accepted decided-field values (kind `decision`). */
  values?: Record<string, unknown>;
  /** Public-channel utterance submitted with the decision. */
  say?: string;
  /** Note to the modeler submitted with the decision. */
  note?: string;
  /** Private memory written with the decision. */
  memory?: string;
  /** Epoch ms. */
  at: number;
}

/** One pending external decision for a single agent in the open turn. */
export interface DecisionRequest {
  /** Unique id per request (never reused within a controller's lifetime). */
  id: string;
  /** The tick this turn will produce when finalized. */
  round: number;
  /** Deciding breed name. */
  breed: string;
  /** Agent id within the breed. */
  agentId: number;
  /** Field specs the submission must satisfy. */
  fields: readonly RoundFieldSpec[];
  /** Snapshot of the agent's own fields, taken when the turn opened. */
  observation: Record<string, unknown>;
  /** The agent's private memory, as written by its latest decision. */
  memory: string;
  /**
   * Direct messages delivered to this agent: everything queued since its
   * previous decision, plus messages that arrive live while this request is
   * pending (the array is appended to in place).
   */
  inbox: readonly AgentMessage[];
  /** Other agents holding open requests this turn (potential interlocutors). */
  peers: readonly AgentRef[];
  /**
   * Recent public-channel history. References the live bounded log, so
   * utterances from agents who decide earlier in the turn are visible to
   * agents still deliberating.
   */
  channel: readonly ChannelMessage[];
  /** Epoch ms deadline. Recomputed when a paused world resumes. */
  deadline: number;
  /**
   * The agent's most recent interactions (its decisions with extras, direct
   * messages sent and received, timeouts), oldest first. Present when the
   * breed declares an agent config; bounded by its `memory` window.
   */
  interactions?: readonly RoundTranscriptEntry[];
  /**
   * Direct-message history with each peer this agent has previously
   * interacted with, keyed `breed:agentId`. Present when the breed's agent
   * config sets `recognise: true`; only peers with history appear.
   */
  peerHistory?: Readonly<Record<string, readonly RoundTranscriptEntry[]>>;
}

/** Result of `world.submitDecision`. Late/invalid submissions never throw. */
export type SubmitDecisionResult = { ok: true } | { ok: false; error: string };

/** Turn progress information included in model snapshots. */
export interface RoundSnapshot {
  /** True while a turn is in flight (issued requests not yet finalized). */
  open: boolean;
  /** Tick the open (or next) turn will produce. */
  round: number;
  /** Unresolved requests. */
  pending: number;
  /** Requests issued this turn. */
  total: number;
  /** Epoch ms deadline of the open turn (0 when no turn is open). */
  deadline: number;
}

/**
 * Agent access used by the engine's turn state machine.
 *
 * The engine is agnostic of how agent records are stored; the model API
 * supplies an adapter closing over its breed registries.
 */
export interface RoundAgentAdapter {
  /** Returns the ids of all live agents of a deciding breed. */
  listAgentIds(breed: string): number[];
  /** Sets the engine-managed `decided` flag on an agent. */
  setDecided(breed: string, agentId: number, decided: boolean): void;
  /** Writes validated decision values onto an agent. */
  writeFields(breed: string, agentId: number, values: Record<string, unknown>): void;
  /** Returns a snapshot of the agent's own fields for the observation. */
  observe(breed: string, agentId: number): Record<string, unknown>;
}

/** Full turn configuration installed on a `WorldController`. */
export interface WorldRoundConfig {
  /** Per-turn decision deadline, in seconds (> 0, fractional allowed). */
  timeoutSeconds: number;
  /** Field specs of externally decided fields, keyed by breed name. */
  decide: Record<string, readonly RoundFieldSpec[]>;
  /** Agent access supplied by the model layer. */
  adapter: RoundAgentAdapter;
  /**
   * Number of autonomic `step` sub-steps to run per round, for models that
   * mix `round` and `step` sections (deterministic — the count is fixed,
   * independent of how long deliberation took). Ignored by pure-round models.
   * Defaults to 1.
   */
  stepsPerRound?: number;
}
