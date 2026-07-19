/**
 * Query primitives for selecting, iterating, and mutating agent collections.
 *
 * This module holds the fluent query API used by turtles, patches, and breeds.
 * It is intentionally generic so higher-level model code can reuse the same
 * semantics for filtering, randomized iteration, and staged batch updates.
 */
import { SeededRandom } from "./random";

interface AgentQueryOptions<T> {
  distanceBetween?: (left: T, right: T) => number;
  isSame?: (left: T, right: T) => boolean;
  stringMatcher?: (item: T, matcher: string) => boolean;
  /**
   * Storage-aware staged-write implementation used by {@link AgentQuery.askBatch}.
   *
   * When present, the query delegates the whole staged pass (draft creation,
   * effect execution, and commit) to the owning collection, which can stage
   * writes directly in its own storage instead of per-item draft copies. The
   * implementation must preserve askBatch semantics: effects read pre-pass
   * values and no item observes another's writes within the pass.
   */
  batchApply?: (items: T[], effect: (item: T, draft: T) => void) => void;
}

const BATCH_MUTATOR_METHODS = new Set([
  "setRandomPosition",
  "turn",
  "forward",
]);

export class AgentQuery<T extends object> {
  constructor(
    private readonly resolve: () => T[],
    private readonly random: SeededRandom,
    private readonly options?: AgentQueryOptions<T>,
    private readonly sampleOne?: () => T | undefined,
  ) {}

  /**
   * Narrows the query using one or more matchers.
   *
   * Matchers are applied in sequence and each one filters the result of the
   * previous matcher. String matchers use the query's configured string matcher
   * when present, otherwise they compare against `state` and `status` fields.
   * Partial object matchers require exact equality on each provided property.
   */
  filter(predicate: (item: T) => boolean): AgentQuery<T>;
  /** Filters by exact property equality. */
  filter(partial: Partial<T>): AgentQuery<T>;
  /** Filters by `state` or `status` when the target item exposes either field. */
  filter(stateOrStatus: string): AgentQuery<T>;
  filter(...matchers: (((item: T) => boolean) | Partial<T> | string)[]): AgentQuery<T>;
  filter(
    matcher: ((item: T) => boolean) | Partial<T> | string,
  ): AgentQuery<T>;
  filter(
    ...matchers: (((item: T) => boolean) | Partial<T> | string)[]
  ) {
    if (matchers.length === 0) {
      return this;
    }

    let query: AgentQuery<T> = this;

    for (const matcher of matchers) {
      query = query.filterOne(matcher);
    }

    return query;
  }

  /**
   * Alias for {@link filter} with partial object matchers.
   *
   * This is primarily a convenience for query expressions that read more like
   * declarative predicates than code.
   */
  where(...partials: Partial<T>[]) {
    return this.filter(...partials);
  }

  private filterOne(
    matcher: ((item: T) => boolean) | Partial<T> | string,
  ) {
    if (typeof matcher === "function") {
      return this.clone(
        () => this.resolve().filter(matcher),
        () => this.sampleMatching(matcher),
      );
    }

    if (typeof matcher === "string") {
      const predicate = (item: T) => {
        if (this.options?.stringMatcher) {
          return this.options.stringMatcher(item, matcher);
        }

        const candidate = item as T & {
          state?: unknown;
          status?: unknown;
        };
        return candidate.state === matcher || candidate.status === matcher;
      };

      return this.clone(
        () => this.resolve().filter(predicate),
        () => this.sampleMatching(predicate),
      );
    }

    const predicate = (item: T) =>
      Object.entries(matcher).every(
        ([key, value]) => item[key as keyof T] === value,
      );

    return this.clone(
      () => this.resolve().filter(predicate),
      () => this.sampleMatching(predicate),
    );
  }

  /**
   * Excludes the provided item from the query.
   *
   * Identity is controlled by the query options; for world queries this uses
   * turtle `id` or patch coordinates rather than object reference equality.
   */
  other(item: T) {
    const isSame = this.options?.isSame ?? ((left: T, right: T) => Object.is(left, right));
    return this.clone(() => this.resolve().filter((candidate) => !isSame(candidate, item)));
  }

  /**
   * Returns only the items within `radius` of `item`.
   *
   * Requires a query configured with spatial distance support.
   */
  inRadiusOf(item: T, radius: number) {
    const distanceBetween = this.requireDistanceBetween();
    return this.clone(
      () =>
        this.resolve().filter(
          (candidate) => distanceBetween(candidate, item) <= radius,
        ),
    );
  }

  /**
   * Returns the closest item to `item`, or `undefined` if the query is empty.
   *
   * Requires a query configured with spatial distance support.
   */
  nearestTo(item: T) {
    const distanceBetween = this.requireDistanceBetween();
    const items = this.resolve();
    let nearest: T | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of items) {
      const distance = distanceBetween(candidate, item);
      if (distance < bestDistance) {
        nearest = candidate;
        bestDistance = distance;
      }
    }

    return nearest;
  }

  /**
   * Executes `effect` on each item in randomized order.
   *
   * Changes take effect immediately on the underlying objects, so later items
   * in the same `ask` may observe earlier mutations.
   */
  ask(effect: (item: T) => void) {
    for (const item of this.random.shuffle(this.resolve())) {
      effect(item);
    }
  }

  /**
   * Executes `effect` on each item in randomized order using staged writes.
   *
   * The first argument is a read-only proxy of the source item. Mutating methods
   * and direct writes on that source view throw. The second argument is a draft
   * object that may be mutated freely. All staged drafts are committed only after
   * every effect has run, which prevents later items from seeing earlier writes
   * within the same batch.
   */
  askBatch(effect: (item: T, draft: T) => void) {
    if (this.options?.batchApply) {
      this.options.batchApply(this.resolve(), effect);
      return;
    }

    const items = this.random.shuffle(this.resolve());
    const staged = items.map((item) => {
      const draft = { ...item };
      effect(this.createBatchSourceView(item), draft);
      return { item, draft };
    });

    for (const { item, draft } of staged) {
      this.commitBatchDraft(item, draft);
    }
  }

  /**
   * Updates all items in the query.
   *
   * When called with a state string, `state` is assigned first and
   * `previousState` is updated to the prior value only when the target item
   * explicitly tracks that field. When called with values only, properties are
   * merged in place without touching `state`.
   */
  set(state: string): void;
  set(state: string, values: Partial<T>): void;
  set(values: Partial<T>): void;
  set(
    first: string | Partial<T>,
    second?: Partial<T>,
  ) {
    if (typeof first === "string") {
      this.applySet(first, second ?? {});
      return;
    }

    this.applySet(undefined, first);
  }

  /**
   * Stages updates across the entire query before committing them.
   *
   * Unlike {@link set}, all items are first copied into drafts so the mutation
   * set is isolated from the live objects until the batch is committed. This is
   * the right choice when a mutation should not be visible to later items in the
   * same update pass. State transitions are finalized during commit, so items
   * that explicitly track `previousState` reflect the live item unless the
   * draft explicitly overrides it.
   */
  setBatch(state: string): void;
  setBatch(state: string, values: Partial<T>): void;
  setBatch(values: Partial<T>): void;
  setBatch(
    first: string | Partial<T>,
    second?: Partial<T>,
  ) {
    const items = this.resolve();

    for (const item of items) {
      const draft = { ...item };

      if (typeof first === "string") {
        const candidate = draft as T & {
          state?: unknown;
        };
        candidate.state = first;
        Object.assign(draft, second ?? {});
      } else {
        Object.assign(draft, first);
      }

      this.commitBatchDraft(item, draft);
    }
  }

  count() {
    return this.resolve().length;
  }

  first() {
    return this.resolve()[0];
  }

  oneOf() {
    if (this.sampleOne) {
      return this.sampleOne();
    }

    const items = this.resolve();
    if (items.length === 0) {
      return undefined;
    }

    return items[this.random.int(items.length)];
  }

  nOf(count: number) {
    return this.random.shuffle(this.resolve()).slice(0, count);
  }

  get length() {
    return this.resolve().length;
  }

  [Symbol.iterator]() {
    return this.resolve()[Symbol.iterator]();
  }

  at(index: number) {
    return this.resolve().at(index);
  }

  forEach(
    callbackfn: (value: T, index: number, array: T[]) => void,
    thisArg?: unknown,
  ) {
    this.resolve().forEach(callbackfn, thisArg);
  }

  map<U>(
    callbackfn: (value: T, index: number, array: T[]) => U,
    thisArg?: unknown,
  ) {
    return this.resolve().map(callbackfn, thisArg);
  }

  flatMap<U>(
    callbackfn: (value: T, index: number, array: T[]) => U | readonly U[],
    thisArg?: unknown,
  ) {
    return this.resolve().flatMap(callbackfn, thisArg);
  }

  some(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: unknown,
  ) {
    return this.resolve().some(predicate, thisArg);
  }

  every(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: unknown,
  ) {
    return this.resolve().every(predicate, thisArg);
  }

  find<S extends T>(
    predicate: (value: T, index: number, obj: T[]) => value is S,
    thisArg?: unknown,
  ): S | undefined;
  find(
    predicate: (value: T, index: number, obj: T[]) => unknown,
    thisArg?: unknown,
  ): T | undefined;
  find(
    predicate: (value: T, index: number, obj: T[]) => unknown,
    thisArg?: unknown,
  ) {
    return this.resolve().find(predicate, thisArg);
  }

  reduce(
    callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T,
  ): T;
  reduce(
    callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T,
    initialValue: T,
  ): T;
  reduce<U>(
    callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U,
    initialValue: U,
  ): U;
  reduce<U>(
    callbackfn: (
      previousValue: T | U,
      currentValue: T,
      currentIndex: number,
      array: T[],
    ) => T | U,
    initialValue?: T | U,
  ) {
    if (arguments.length > 1) {
      return this.resolve().reduce(callbackfn, initialValue as T | U);
    }

    return this.resolve().reduce(callbackfn as (
      previousValue: T,
      currentValue: T,
      currentIndex: number,
      array: T[],
    ) => T);
  }

  toArray() {
    return [...this.resolve()];
  }

  /**
   * Returns a materialized array copy of the query result.
   *
   * This is equivalent to {@link toArray} and is useful when the consumer wants
   * a stable snapshot before subsequent mutations.
   */
  snapshot() {
    return this.toArray();
  }

  private clone(resolve: () => T[], sampleOne?: () => T | undefined) {
    return new AgentQuery(resolve, this.random, this.options, sampleOne);
  }

  private sampleMatching(predicate: (item: T) => boolean) {
    const items = this.resolve();
    if (items.length === 0) {
      return undefined;
    }

    const randomAttempts = Math.min(items.length, 64);
    for (let attempt = 0; attempt < randomAttempts; attempt += 1) {
      const candidate = items[this.random.int(items.length)];
      if (candidate && predicate(candidate)) {
        return candidate;
      }
    }

    let selected: T | undefined;
    let matches = 0;
    for (const item of items) {
      if (!predicate(item)) {
        continue;
      }

      matches += 1;
      if (this.random.int(matches) === 0) {
        selected = item;
      }
    }

    return selected;
  }

  private applySet(state: string | undefined, values: Partial<T>) {
    for (const item of this.resolve()) {
      if (state !== undefined) {
        const candidate = item as T & {
          state?: unknown;
          previousState?: unknown;
        };
        // `in` rather than hasOwnProperty: patch fields are prototype
        // accessors, and `previousState` must keep tracking for them too.
        if ("previousState" in candidate) {
          candidate.previousState = candidate.state;
        }
        candidate.state = state;
      }

      Object.assign(item, values);
    }
  }

  private createBatchSourceView(item: T) {
    return new Proxy(item, {
      set() {
        throw new Error("askBatch source values are read-only. Write staged changes to the draft.");
      },
      deleteProperty() {
        throw new Error("askBatch source values are read-only. Write staged changes to the draft.");
      },
      defineProperty() {
        throw new Error("askBatch source values are read-only. Write staged changes to the draft.");
      },
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);

        if (typeof value === "function") {
          if (BATCH_MUTATOR_METHODS.has(String(property))) {
            return () => {
              throw new Error(
                `askBatch does not allow calling mutating method "${String(property)}" on the source value.`,
              );
            };
          }

          return value.bind(target);
        }

        return value;
      },
    });
  }

  private commitBatchDraft(item: T, draft: T) {
    const original = item as Record<string, unknown>;
    const staged = draft as Record<string, unknown>;
    const stateChanged = staged.state !== original.state;
    const previousStateChanged = staged.previousState !== original.previousState;

    if (
      stateChanged &&
      !previousStateChanged &&
      Object.prototype.hasOwnProperty.call(original, "previousState")
    ) {
      original.previousState = original.state;
    }

    for (const [key, value] of Object.entries(staged)) {
      if (typeof value === "function") {
        continue;
      }

      if (original[key] !== value) {
        original[key] = value;
      }
    }
  }

  private requireDistanceBetween() {
    if (!this.options?.distanceBetween) {
      throw new Error("This query does not support spatial operations.");
    }

    return this.options.distanceBetween;
  }
}
