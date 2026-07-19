/**
 * Engine random utilities.
 *
 * This file owns the deterministic pseudo-random generator used across query
 * ordering, simulation randomness, and repeatable model runs.
 */

type RandomKeyPart = string | number | boolean | null | undefined;

const UINT32_SIZE = 4294967296;

export function normalizeRandomSeed(seed: number | string) {
  const numeric = Number(seed);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric) >>> 0;
  }

  let hash = 0x811c9dc5;
  hash = mixString(hash, String(seed));
  return hash >>> 0;
}

function mixHash(hash: number, value: number) {
  let next = (hash ^ value) >>> 0;
  next = Math.imul(next ^ (next >>> 16), 0x7feb352d) >>> 0;
  next = Math.imul(next ^ (next >>> 15), 0x846ca68b) >>> 0;
  return (next ^ (next >>> 16)) >>> 0;
}

function mixString(hash: number, value: string) {
  let next = hash >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    next = mixHash(next, value.charCodeAt(index));
  }
  return next;
}

function hashKeyParts(seed: number | string, parts: readonly RandomKeyPart[]) {
  let hash = mixHash(0x811c9dc5, normalizeRandomSeed(seed));

  for (const part of parts) {
    hash = mixString(hash, typeof part);
    hash = mixString(hash, String(part));
    hash = mixHash(hash, 0x9e3779b9);
  }

  return hash >>> 0;
}

export function randomUnitForKey(seed: number | string, ...parts: RandomKeyPart[]) {
  return hashKeyParts(seed, parts) / UINT32_SIZE;
}

export function randomFloatForKey(
  seed: number | string,
  max = 1,
  ...parts: RandomKeyPart[]
) {
  return randomUnitForKey(seed, ...parts) * max;
}

export function randomIntForKey(
  seed: number | string,
  max: number,
  ...parts: RandomKeyPart[]
) {
  return Math.floor(randomFloatForKey(seed, max, ...parts));
}

export class SeededRandom {
  private state: number;
  private seed: number;

  /**
   * Creates a deterministic pseudo-random generator.
   *
   * The sequence is stable for a given seed and is shared across query helpers
   * and world operations.
   */
  constructor(seed = 1) {
    this.seed = normalizeRandomSeed(seed);
    this.state = this.seed;
  }

  /** Returns the seed used to initialize or reset the current sequence. */
  getSeed() {
    return this.seed;
  }

  /** Resets the generator to a new seed. */
  setSeed(seed: number | string) {
    this.seed = normalizeRandomSeed(seed);
    this.state = this.seed;
  }

  /** Returns the next normalized random value in the half-open interval `[0, 1)`. */
  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  /** Returns a random floating-point value in the half-open interval `[0, max)`. */
  float(max = 1) {
    return this.next() * max;
  }

  /** Returns a random integer in the half-open interval `[0, max)`. */
  int(max: number) {
    return Math.floor(this.float(max));
  }

  /** Returns a random floating-point value centered around zero within `[-span / 2, span / 2)`. */
  centered(span: number) {
    return this.float(span) - span / 2;
  }

  /** Returns a keyed deterministic float without advancing this generator's sequence. */
  keyedFloat(max = 1, ...parts: RandomKeyPart[]) {
    return randomFloatForKey(this.seed, max, ...parts);
  }

  /** Returns a keyed deterministic integer without advancing this generator's sequence. */
  keyedInt(max: number, ...parts: RandomKeyPart[]) {
    return randomIntForKey(this.seed, max, ...parts);
  }

  /**
   * Returns a shuffled copy of the provided array.
   *
   * The input array is not mutated.
   */
  shuffle<T>(items: T[]) {
    const copy = [...items];

    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(index + 1);
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }

    return copy;
  }
}
