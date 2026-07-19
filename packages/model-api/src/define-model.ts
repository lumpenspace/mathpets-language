/**
 * Public model factory entry point.
 *
 * This thin wrapper keeps the external API stable while delegating the actual
 * implementation work to {@link ModelBuilder}.
 */
import { ModelDefinition } from "./model-definition";
import { ModelBuilder } from "./model-builder";

/**
 * Builds a model definition from a fluent builder callback.
 *
 * The callback receives a mutable builder that can declare the world, params,
 * states, board config, and action hooks. The returned object is the public
 * model surface consumed by the rest of the app.
 */
export function defineModel(factory: (model: ModelBuilder) => void): ModelDefinition {
  const builder = new ModelBuilder();
  factory(builder);
  builder.finalize();

  return {
    world: builder.worldController,
    params: builder.paramFields,
    globals: builder.globalFields,
    states: builder.states,
    draw: builder.draw,
    getBoardConfig: () => builder.getBoardConfig(),
    getSnapshot: () => builder.getSnapshot(),
    getServerSnapshot: () => builder.getServerSnapshot(),
    getRandomSeed: () => builder.getRandomSeed(),
    isRandomSeedPinned: () => builder.isRandomSeedPinned(),
    setRandomSeed: (seed, options) => builder.setRandomSeed(seed, options),
    clearRandomSeed: () => builder.clearRandomSeed(),
    setParamValue: (key, value) => builder.setParamValue(key, value),
    setGlobalValue: (key, value) => builder.setGlobalValue(key, value),
    applyWallMap: (rows, options) => builder.applyWallMap(rows, options),
    setWallMap: (rows, options) => builder.setWallMap(rows, options),
    clearWalls: () => builder.clearWalls(),
    hasBrush: builder.hasBrush,
    applyBrush: builder.hasBrush
      ? (px: number, py: number) => builder.applyBrush(px, py)
      : undefined,
    restart: () => {
      builder.worldController.batch(() => {
        builder.clearAll();
        builder.worldController.setup?.();
        builder.worldController.markReady();
      });
    },
  };
}
