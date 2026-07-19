/**
 * Public barrel for the simulation engine package.
 *
 * The engine is split into focused modules so world lifecycle, queries,
 * geometry, and deterministic randomness can evolve independently while the
 * package still exposes a single stable import surface.
 */
export * from "./agent-query";
export * from "./decision-schema";
export * from "./geometry";
export * from "./random";
export * from "./round";
export * from "./turtle-icons";
export * from "./types";
export * from "./world-controller";
