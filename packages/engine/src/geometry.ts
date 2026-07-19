/**
 * Engine geometry helpers.
 *
 * This file keeps the low-level heading and coordinate math used by turtles,
 * patch lookup, and spatial queries in one place.
 */

/**
 * Normalizes a NetLogo heading into the canonical range `[0, 360)`.
 */
export function normalizeHeading(heading: number) {
  const wrapped = heading % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Converts a NetLogo heading to a unit vector.
 *
 * Heading `0` points north, `90` points east, `180` south, and `270` west.
 */
export function netLogoHeadingToVector(heading: number) {
  const radians = (heading * Math.PI) / 180;
  return {
    x: Math.sin(radians),
    y: Math.cos(radians),
  };
}

/**
 * Converts a NetLogo heading to canvas radians.
 *
 * Canvas paths are authored facing east at rotation `0`, while NetLogo heading
 * `0` is north and positive headings turn clockwise.
 */
export function netLogoHeadingToCanvasRadians(heading: number) {
  return ((normalizeHeading(heading) - 90) * Math.PI) / 180;
}

/**
 * Converts a vector back into a NetLogo heading in the canonical range.
 */
export function vectorToNetLogoHeading(x: number, y: number) {
  return normalizeHeading((Math.atan2(x, y) * 180) / Math.PI);
}

/**
 * Applies either clamping or wrapping to a coordinate within an inclusive span.
 */
export function wrapCoordinate(
  value: number,
  min: number,
  max: number,
  wrap: boolean,
) {
  if (!wrap) {
    return Math.max(min, Math.min(max, value));
  }

  const span = max - min + 1;
  const offset = value - min;
  return ((((offset % span) + span) % span) + min);
}
