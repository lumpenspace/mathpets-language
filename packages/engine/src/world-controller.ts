/**
 * World lifecycle and clock management for the simulation engine.
 *
 * This module owns the scheduler-facing state of a model: run status, ticks,
 * seeded randomness, setup/step hooks, and subscriptions used by React and the
 * higher-level model API.
 */
import { SeededRandom } from "./random";
import {
  AgentMessage,
  AgentRef,
  ChannelMessage,
  DecisionExtras,
  DecisionRequest,
  SubmitDecisionResult,
  RoundFieldSpec,
  RoundSnapshot,
  RoundTranscriptEntry,
  WorldRoundConfig,
} from "./round";
import { WorldConfig, WorldStatus } from "./types";

/** Retained public-channel messages; older entries are dropped. */
const CHANNEL_HISTORY_LIMIT = 200;
/** Retained transcript entries; older entries are dropped. */
const TRANSCRIPT_HISTORY_LIMIT = 1000;

/** Map key for per-agent protocol state. */
function agentKey(ref: { breed: string; agentId: number }) {
  return `${ref.breed}:${ref.agentId}`;
}

/** Internal bookkeeping for the turn currently in flight. */
interface OpenTurnState {
  /** Tick this turn will produce when finalized. */
  round: number;
  /** Absolute epoch ms deadline (recomputed on resume). */
  deadline: number;
  /** Remaining ms frozen while paused, `null` while running. */
  frozenRemainingMs: number | null;
  /** Number of requests issued when the turn opened. */
  total: number;
  /** Unresolved requests, keyed by request id. */
  requests: Map<string, DecisionRequest>;
}

export class WorldController {
  /**
   * Deterministic world clock and lifecycle controller.
   *
   * The controller owns simulation state such as `ticks`, status, listeners and
   * the seeded RNG used by queries and movement helpers.
   */
  readonly random = new SeededRandom(1);
  ticks = 0;
  setup: (() => void) | undefined;
  step: (() => void) | undefined;
  /**
   * Optional per-agent async phase of a turn-based model.
   *
   * Assigned by the model alongside `step`; invoked with the agent id whose
   * external decision just arrived (after the decided fields were written).
   */
  asyncStep: ((agentId: number) => void) | undefined;
  /**
   * Barrier phase of a model that mixes `turn` and `step` sections.
   *
   * Only assigned for mixed models: it holds the `turn` barrier transitions,
   * while `step` holds the autonomic per-tick transitions. Pure turn-based
   * models keep their barrier in `step` (so `barrierStep` is undefined), and
   * pure step models never set it. Runs once per round at finalize, before the
   * autonomic sub-steps, and never advances the tick itself.
   */
  barrierStep: (() => void) | undefined;
  endCondition: (() => boolean) | undefined;
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private batchDepth = 0;
  private pendingEmit = false;
  private roundConfig: WorldRoundConfig | null = null;
  private openRound: OpenTurnState | null = null;
  private nextDecisionId = 1;
  /** Shared monotonic sequence for transcript, messages, and channel posts. */
  private nextProtocolSeq = 1;
  /** Private agent memory, keyed `breed:agentId`, written via decisions. */
  private readonly agentMemories = new Map<string, string>();
  /** Messages addressed to agents without an open request, keyed `breed:agentId`. */
  private readonly queuedInboxes = new Map<string, AgentMessage[]>();
  /** Bounded public-channel log. Requests hold a live reference to it. */
  private channelLog: ChannelMessage[] = [];
  /** Bounded inspectable event log; survives `finish`, cleared on reset/setup. */
  private transcriptLog: RoundTranscriptEntry[] = [];

  private currentStatus: WorldStatus = "idle";

  /**
   * Creates a controller for a world with the provided bounds and topology.
   */
  constructor(public config: WorldConfig) {}

  /** Replaces the current world bounds without resetting lifecycle state. */
  reconfigure(config: WorldConfig) {
    this.config = config;
  }

  private shouldRunSetup() {
    return this.currentStatus === "idle" || this.currentStatus === "finished";
  }

  /**
   * Starts the world.
   *
   * If the world is `idle` or `finished`, `setup` runs before entering the
   * running state. The `setup` callback is not re-run when resuming from
   * `paused`.
   */
  start() {
    this.batch(() => {
      if (this.shouldRunSetup()) {
        this.discardOpenRound();
        this.clearRoundProtocolState();
        this.setup?.();
        this.currentStatus = "ready";
      }

      this.currentStatus = "running";
      this.emit();
    });
  }

  /**
   * Pauses a running world without resetting ticks or state.
   *
   * When a turn is in flight, the remaining deadline is frozen and recomputed
   * on resume so paused worlds never time their agents out.
   */
  pause() {
    if (this.currentStatus === "running") {
      if (this.openRound) {
        this.openRound.frozenRemainingMs = Math.max(0, this.openRound.deadline - Date.now());
      }

      this.currentStatus = "paused";
      this.emit();
    }
  }

  /** Resumes a paused world, recomputing any frozen turn deadline. */
  resume() {
    if (this.currentStatus === "paused") {
      if (this.openRound && this.openRound.frozenRemainingMs !== null) {
        this.openRound.deadline = Date.now() + this.openRound.frozenRemainingMs;
        this.openRound.frozenRemainingMs = null;
        for (const request of this.openRound.requests.values()) {
          request.deadline = this.openRound.deadline;
        }
      }

      this.currentStatus = "running";
      this.emit();
    }
  }

  /**
   * Resets the world clock and returns the controller to `idle`.
   *
   * This does not rebuild patches or turtles; callers are responsible for
   * clearing model state separately when needed.
   */
  reset() {
    this.discardOpenRound();
    this.clearRoundProtocolState();
    this.ticks = 0;
    this.currentStatus = "idle";
    this.emit();
  }

  /**
   * Runs a single simulation tick.
   *
   * The end condition is checked before the step function. If it is already
   * satisfied, the world is finished immediately and the step is skipped.
   *
   * Turn-based models (configured via {@link configureRound}) advance through
   * the turn state machine instead: a tick with no turn in flight opens one,
   * and a tick whose turn is fully decided or past its deadline finalizes it
   * by running the barrier `step`. Ticks in between are no-ops.
   */
  runTick() {
    this.batch(() => {
      if (this.roundConfig) {
        this.advanceRound();
        return;
      }

      if (this.endCondition?.() === true) {
        this.finish();
        return;
      }

      this.step?.();
      this.emit();
    });
  }

  /**
   * Runs setup if needed and then executes exactly one step while the world is
   * `ready` or `paused`. For turn-based models this advances the turn state
   * machine exactly like {@link runTick}.
   */
  stepOnce() {
    this.batch(() => {
      if (this.shouldRunSetup()) {
        this.discardOpenRound();
        this.clearRoundProtocolState();
        this.setup?.();
        this.currentStatus = "ready";
      }

      if (this.currentStatus === "ready" || this.currentStatus === "paused") {
        if (this.roundConfig) {
          this.advanceRound();
          return;
        }

        if (this.endCondition?.() === true) {
          this.finish();
          return;
        }

        this.step?.();
        this.emit();
      }
    });
  }

  /** Marks the world as ready to run without invoking `setup`. */
  markReady() {
    this.currentStatus = "ready";
    this.emit();
  }

  /** Forces the world into the finished state, discarding any open round. */
  finish() {
    this.discardOpenRound();
    this.currentStatus = "finished";
    this.emit();
  }

  /**
   * Installs the turn-based configuration for this world.
   *
   * Called once by the model layer (from `m.turn(...)`) during model
   * construction. Worlds without a turn configuration keep the free-running
   * tick behavior unchanged.
   */
  configureRound(config: WorldRoundConfig) {
    this.roundConfig = config;
  }

  /** Returns the turn configuration summary, or `null` for step models. */
  roundInfo(): {
    enabled: boolean;
    timeoutSeconds: number;
  } | null {
    if (!this.roundConfig) {
      return null;
    }

    return {
      enabled: true,
      timeoutSeconds: this.roundConfig.timeoutSeconds,
    };
  }

  /**
   * Returns an agent's most recent interactions, oldest first: its own
   * decisions (with say/note/memory), direct messages it sent or received,
   * and its timeouts — everything the bounded transcript still holds.
   */
  interactionsOf(breed: string, agentId: number, limit?: number): RoundTranscriptEntry[] {
    const involved = this.transcriptLog.filter(
      (entry) =>
        (entry.breed === breed && entry.agentId === agentId) ||
        (entry.kind === "message" &&
          entry.to?.breed === breed &&
          entry.to.agentId === agentId),
    );

    return limit !== undefined && limit >= 0 ? involved.slice(-limit) : involved;
  }

  /**
   * Returns the direct-message history between two agents, oldest first —
   * the record backing `peerHistory` when a breed's agents recognise each
   * other.
   */
  interactionsBetween(a: AgentRef, b: AgentRef, limit?: number): RoundTranscriptEntry[] {
    const between = this.transcriptLog.filter((entry) => {
      if (entry.kind !== "message" || !entry.to) {
        return false;
      }

      const fromA = entry.breed === a.breed && entry.agentId === a.agentId;
      const fromB = entry.breed === b.breed && entry.agentId === b.agentId;
      const toA = entry.to.breed === a.breed && entry.to.agentId === a.agentId;
      const toB = entry.to.breed === b.breed && entry.to.agentId === b.agentId;
      return (fromA && toB) || (fromB && toA);
    });

    return limit !== undefined && limit >= 0 ? between.slice(-limit) : between;
  }

  /** Returns the unresolved decision requests of the open round. */
  pendingDecisions(): DecisionRequest[] {
    if (!this.openRound) {
      return [];
    }

    return [...this.openRound.requests.values()];
  }

  /** Returns turn progress for snapshots, or `null` for step models. */
  roundSnapshot(): RoundSnapshot | null {
    if (!this.roundConfig) {
      return null;
    }

    if (!this.openRound) {
      return { open: false, round: this.ticks + 1, pending: 0, total: 0, deadline: 0 };
    }

    return {
      open: true,
      round: this.openRound.round,
      pending: this.openRound.requests.size,
      total: this.openRound.total,
      deadline: this.openRound.deadline,
    };
  }

  /**
   * Resolves one decision request with externally decided field values.
   *
   * Validates every declared field against its spec, writes the values onto
   * the agent, marks it `decided`, runs the model's `asyncStep` for that
   * agent, and notifies subscribers. Unknown, duplicate, late (post-finalize)
   * or invalid submissions return `{ ok: false, error }` without changing
   * anything and without throwing.
   *
   * `extras` carries the optional protocol channels of the agent's turn —
   * `say` (public channel), `note` (to the modeler), `memory` (private,
   * handed back on the agent's next request). Everything submitted here is
   * recorded in the turn transcript.
   */
  submitDecision(
    requestId: string,
    values: Record<string, unknown>,
    extras?: DecisionExtras,
  ): SubmitDecisionResult {
    const config = this.roundConfig;
    if (!config) {
      return { ok: false, error: "This model is not turn-based." };
    }

    const round = this.openRound;
    if (!round) {
      return { ok: false, error: "No round is open; the decision arrived too late." };
    }

    const request = round.requests.get(requestId);
    if (!request) {
      return {
        ok: false,
        error: `Unknown or already resolved decision request "${requestId}".`,
      };
    }

    const provided = values ?? {};
    const declaredNames = new Set(request.fields.map((field) => field.name));
    for (const key of Object.keys(provided)) {
      if (!declaredNames.has(key)) {
        return { ok: false, error: `"${key}" is not a decided field of this request.` };
      }
    }

    const accepted: Record<string, unknown> = {};
    for (const field of request.fields) {
      if (!(field.name in provided)) {
        return { ok: false, error: `Missing value for decided field "${field.name}".` };
      }

      const error = this.validateDecisionValue(field, provided[field.name]);
      if (error) {
        return { ok: false, error };
      }

      accepted[field.name] = provided[field.name];
    }

    const extrasError = this.validateExtras(extras);
    if (extrasError) {
      return { ok: false, error: extrasError };
    }

    this.batch(() => {
      config.adapter.writeFields(request.breed, request.agentId, accepted);
      config.adapter.setDecided(request.breed, request.agentId, true);
      round.requests.delete(requestId);

      if (extras?.memory !== undefined) {
        this.agentMemories.set(agentKey(request), extras.memory);
      }

      if (extras?.say !== undefined) {
        this.postToChannel(request, extras.say);
      }

      this.recordTranscript({
        kind: "decision",
        round: request.round,
        breed: request.breed,
        agentId: request.agentId,
        values: accepted,
        ...(extras?.say !== undefined ? { say: extras.say } : {}),
        ...(extras?.note !== undefined ? { note: extras.note } : {}),
        ...(extras?.memory !== undefined ? { memory: extras.memory } : {}),
      });

      this.asyncStep?.(request.agentId);
      this.emit();
    });

    return { ok: true };
  }

  /**
   * Sends a direct message from a still-deliberating agent to another agent.
   *
   * The sender is identified by its pending decision request — once an agent
   * has decided, its turn is concluded and it can no longer speak. Delivery is
   * immediate when the recipient also has an open request (the message is
   * appended to that request's `inbox` in place, so interactive hosts
   * see it mid-turn); otherwise the message is queued and delivered with the
   * recipient's next request. Every message is recorded in the transcript.
   */
  sendAgentMessage(requestId: string, to: AgentRef, text: string): SubmitDecisionResult {
    const config = this.roundConfig;
    if (!config) {
      return { ok: false, error: "This model is not turn-based." };
    }

    const round = this.openRound;
    if (!round) {
      return { ok: false, error: "No round is open; the message arrived too late." };
    }

    const request = round.requests.get(requestId);
    if (!request) {
      return {
        ok: false,
        error: `Unknown or already resolved decision request "${requestId}" — agents can only send messages before concluding their round.`,
      };
    }

    if (typeof text !== "string" || text.length === 0) {
      return { ok: false, error: "Message text must be a non-empty string." };
    }

    if (!to || typeof to.breed !== "string" || !Number.isInteger(to.agentId)) {
      return { ok: false, error: "Message recipient must be { breed, agentId }." };
    }

    if (to.breed === request.breed && to.agentId === request.agentId) {
      return { ok: false, error: "Agents cannot message themselves." };
    }

    if (!(to.breed in config.decide)) {
      return { ok: false, error: `"${to.breed}" is not a deciding breed.` };
    }

    if (!config.adapter.listAgentIds(to.breed).includes(to.agentId)) {
      return {
        ok: false,
        error: `No live agent ${to.agentId} of breed "${to.breed}".`,
      };
    }

    this.batch(() => {
      const message: AgentMessage = {
        seq: this.takeSeq(),
        round: request.round,
        from: { breed: request.breed, agentId: request.agentId },
        to: { breed: to.breed, agentId: to.agentId },
        text,
        at: Date.now(),
      };

      const pendingRecipient = [...round.requests.values()].find(
        (candidate) => candidate.breed === to.breed && candidate.agentId === to.agentId,
      );

      if (pendingRecipient) {
        (pendingRecipient.inbox as AgentMessage[]).push(message);
      } else {
        const key = `${to.breed}:${to.agentId}`;
        const queue = this.queuedInboxes.get(key);
        if (queue) {
          queue.push(message);
        } else {
          this.queuedInboxes.set(key, [message]);
        }
      }

      this.recordTranscript({
        kind: "message",
        round: request.round,
        breed: request.breed,
        agentId: request.agentId,
        to: message.to,
        text,
        seq: message.seq,
        at: message.at,
      });

      this.emit();
    });

    return { ok: true };
  }

  /** Returns the bounded inspectable event log (decisions, messages, timeouts). */
  roundTranscript(): readonly RoundTranscriptEntry[] {
    return this.transcriptLog;
  }

  /** Returns the bounded public-channel history. */
  channelMessages(): readonly ChannelMessage[] {
    return this.channelLog;
  }

  /** Returns an agent's private memory, as last written by one of its decisions. */
  agentMemoryOf(breed: string, agentId: number): string {
    return this.agentMemories.get(`${breed}:${agentId}`) ?? "";
  }

  /** Returns `true` when the world is actively running. */
  isRunning() {
    return this.currentStatus === "running";
  }

  /** Returns the current lifecycle state. */
  status() {
    return this.currentStatus;
  }

  /** Returns the current revision counter used to invalidate snapshots. */
  getRevision() {
    return this.revision;
  }

  /**
   * Registers a listener that runs after every world emission.
   *
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Coalesces multiple lifecycle emissions into one subscriber notification.
   */
  batch<T>(operation: () => T): T {
    this.batchDepth += 1;

    try {
      return operation();
    } finally {
      this.batchDepth -= 1;

      if (this.batchDepth === 0 && this.pendingEmit) {
        this.pendingEmit = false;
        this.emitNow();
      }
    }
  }

  /**
   * Increments the revision counter and notifies subscribers.
   *
   * This is intentionally public so higher-level model code can signal changes
   * without coupling to specific state transitions.
   */
  emit() {
    if (this.batchDepth > 0) {
      this.pendingEmit = true;
      return;
    }

    this.emitNow();
  }

  private emitNow() {
    this.revision += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Advances the turn state machine by one host tick.
   *
   * No turn in flight: evaluate the end condition, then open a round. Turn in
   * flight: finalize it when every request resolved or the deadline passed,
   * otherwise keep waiting (without notifying subscribers).
   */
  private advanceRound() {
    if (!this.openRound) {
      if (this.endCondition?.() === true) {
        this.finish();
        return;
      }

      this.openNextRound();
      return;
    }

    if (this.openRound.requests.size > 0 && !this.isRoundDeadlinePassed()) {
      return;
    }

    this.finalizeRound();
  }

  /** Issues decision requests for every live agent of every deciding breed. */
  private openNextRound() {
    const config = this.roundConfig;
    if (!config) {
      return;
    }

    const roundNumber = this.ticks + 1;
    const deadline = Date.now() + config.timeoutSeconds * 1000;
    const requests = new Map<string, DecisionRequest>();
    const participants: AgentRef[] = [];

    for (const [breed, fields] of Object.entries(config.decide)) {
      for (const agentId of config.adapter.listAgentIds(breed)) {
        config.adapter.setDecided(breed, agentId, false);
        const id = `decision-${this.nextDecisionId}`;
        this.nextDecisionId += 1;
        const key = `${breed}:${agentId}`;
        participants.push({ breed, agentId });
        requests.set(id, {
          id,
          round: roundNumber,
          breed,
          agentId,
          fields,
          observation: config.adapter.observe(breed, agentId),
          memory: this.agentMemories.get(key) ?? "",
          // Deliver everything queued since this agent's last request; the
          // array stays live for messages arriving while the turn is open.
          inbox: this.queuedInboxes.get(key) ?? [],
          peers: [],
          channel: this.channelLog,
          deadline,
        });
        this.queuedInboxes.delete(key);
      }
    }

    for (const request of requests.values()) {
      request.peers = participants.filter(
        (peer) => peer.breed !== request.breed || peer.agentId !== request.agentId,
      );

    }

    this.openRound = {
      round: roundNumber,
      deadline,
      frozenRemainingMs: null,
      total: requests.size,
      requests,
    };
    this.emit();
  }

  /**
   * Runs the barrier phase and closes the round.
   *
   * Agents that timed out keep their previous decided-field values and their
   * `decided` flag stays `false` (it was cleared at turn open). The wrapped
   * `step` advances `ticks`; the end condition is evaluated afterwards, per
   * the spec's "run barrier, advance ticks, evaluate stop when" ordering.
   */
  private finalizeRound() {
    // Undecided agents timed out — record them so stragglers stay visible.
    if (this.openRound) {
      for (const request of this.openRound.requests.values()) {
        this.recordTranscript({
          kind: "timeout",
          round: request.round,
          breed: request.breed,
          agentId: request.agentId,
        });
      }
    }

    this.openRound = null;

    // Barrier phase: score this round's decisions. In a pure round model the
    // barrier lives in `step` (and is run by the sub-step loop below); in a
    // mixed model it lives here in `barrierStep` and runs exactly once.
    this.barrierStep?.();

    // Autonomic phase: advance the world clock. `step` increments the tick
    // each call, so a pure round model ticks once per round (reps = 1), while a
    // mixed model fast-forwards its environment by `stepsPerRound` deterministic
    // sub-steps — a fixed count, so replay stays exact regardless of how long
    // deliberation took.
    const reps = this.barrierStep
      ? Math.max(1, Math.floor(this.roundConfig?.stepsPerRound ?? 1))
      : 1;
    for (let index = 0; index < reps; index += 1) {
      this.step?.();
    }

    if (this.endCondition?.() === true) {
      this.finish();
      return;
    }

    this.emit();
  }

  /** True once the open turn's (possibly frozen) deadline has elapsed. */
  private isRoundDeadlinePassed() {
    const round = this.openRound;
    if (!round) {
      return false;
    }

    if (round.frozenRemainingMs !== null) {
      return round.frozenRemainingMs <= 0;
    }

    return Date.now() >= round.deadline;
  }

  /** Drops any open turn and its pending requests (reset/setup/finish). */
  private discardOpenRound() {
    this.openRound = null;
  }

  /**
   * Clears agent memories, queued messages, the public channel, and the
   * transcript. Runs on reset and before a fresh setup — but not on finish,
   * so a completed run stays inspectable.
   */
  private clearRoundProtocolState() {
    this.agentMemories.clear();
    this.queuedInboxes.clear();
    this.channelLog.length = 0;
    this.transcriptLog.length = 0;
  }

  /** Allocates the next shared protocol sequence number. */
  private takeSeq() {
    const seq = this.nextProtocolSeq;
    this.nextProtocolSeq += 1;
    return seq;
  }

  /** Appends one transcript entry, assigning seq/at unless provided. */
  private recordTranscript(
    entry: Omit<RoundTranscriptEntry, "seq" | "at"> & { seq?: number; at?: number },
  ) {
    const { seq, at, ...rest } = entry;
    this.transcriptLog.push({ ...rest, seq: seq ?? this.takeSeq(), at: at ?? Date.now() });

    if (this.transcriptLog.length > TRANSCRIPT_HISTORY_LIMIT) {
      this.transcriptLog.splice(0, this.transcriptLog.length - TRANSCRIPT_HISTORY_LIMIT);
    }
  }

  /** Posts one utterance to the bounded public channel (array identity kept). */
  private postToChannel(request: DecisionRequest, text: string) {
    this.channelLog.push({
      seq: this.takeSeq(),
      round: request.round,
      from: { breed: request.breed, agentId: request.agentId },
      text,
      at: Date.now(),
    });

    if (this.channelLog.length > CHANNEL_HISTORY_LIMIT) {
      this.channelLog.splice(0, this.channelLog.length - CHANNEL_HISTORY_LIMIT);
    }
  }

  /** Validates the optional protocol extras of a decision submission. */
  private validateExtras(extras: DecisionExtras | undefined): string | null {
    if (extras === undefined) {
      return null;
    }

    for (const key of Object.keys(extras)) {
      if (key !== "say" && key !== "note" && key !== "memory") {
        return `Unknown extras field "${key}" (expected say, note, or memory).`;
      }
    }

    for (const key of ["say", "note", "memory"] as const) {
      const value = extras[key];
      if (value !== undefined && typeof value !== "string") {
        return `Extras field "${key}" must be a string.`;
      }
    }

    return null;
  }

  /** Validates one submitted value against its field spec. */
  private validateDecisionValue(field: RoundFieldSpec, value: unknown): string | null {
    if (field.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `Field "${field.name}" expects a finite number.`;
      }

      return null;
    }

    if (field.kind === "boolean") {
      if (typeof value !== "boolean") {
        return `Field "${field.name}" expects a boolean.`;
      }

      return null;
    }

    if (typeof value !== "string") {
      return `Field "${field.name}" expects one of its enum values as a string.`;
    }

    // When enum membership metadata is unavailable at runtime (plain string
    // default in the breed schema), any string is accepted — see RoundFieldSpec.
    if (field.values && !field.values.includes(value)) {
      return `"${value}" is not a valid value for field "${field.name}" (expected one of: ${field.values.join(", ")}).`;
    }

    return null;
  }
}
