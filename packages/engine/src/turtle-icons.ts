import { netLogoHeadingToCanvasRadians } from "./geometry";
import type { StateStyle, TurtleLike } from "./types";

export type TurtleIconCategory =
  | "animals"
  | "nature"
  | "shapes"
  | "engineering"
  | "sprites";

export const TURTLE_ICON_DEFAULT_HEADING_DEGREES = 45;
export const TURTLE_ICON_DEFAULT_HEADING_RADIANS = netLogoHeadingToCanvasRadians(
  TURTLE_ICON_DEFAULT_HEADING_DEGREES,
);
const TURTLE_ICON_EAST_HEADING_DEGREES = 90;

export interface TurtleIconDefinition {
  name: string;
  label: string;
  orientable: boolean;
  category: TurtleIconCategory;
  source?: string;
  sourceHeadingDegrees?: number;
  /**
   * Multicolor sprites carry their own palette. Renderers must not flat-tint
   * them; the style color is applied as a subtle accent instead.
   */
  multicolor?: boolean;
}

export interface TurtleAppearance {
  shape?: string;
  orientable?: boolean;
}

export interface DrawTurtleIconOptions {
  context: CanvasRenderingContext2D;
  shape?: string;
  orientable?: boolean;
  color: string;
  radius: number;
  /** Target canvas rotation. If omitted, orientable icons face northeast. */
  headingRadians?: number;
}

export const TURTLE_ICON_DEFINITIONS: readonly TurtleIconDefinition[] = [
  { name: "triangle", label: "Triangle", orientable: true, category: "shapes", sourceHeadingDegrees: 90 },
  { name: "arrow", label: "Arrow", orientable: true, category: "shapes", sourceHeadingDegrees: 90 },
  { name: "dart", label: "Dart", orientable: true, category: "shapes", sourceHeadingDegrees: 90 },
  { name: "kite", label: "Kite", orientable: true, category: "shapes", sourceHeadingDegrees: 90 },
  { name: "circle", label: "Circle", orientable: false, category: "shapes", source: "Phosphor Fill" },
  { name: "square", label: "Square", orientable: false, category: "shapes", source: "Phosphor Fill" },
  { name: "diamond", label: "Diamond", orientable: false, category: "shapes", source: "Phosphor Fill" },
  { name: "pentagon", label: "Pentagon", orientable: false, category: "shapes", source: "Phosphor Fill" },
  { name: "hex", label: "Hex", orientable: false, category: "shapes", source: "Phosphor Fill" },
  { name: "star", label: "Star", orientable: false, category: "shapes", source: "Phosphor Fill" },
  { name: "target", label: "Target", orientable: false, category: "shapes", source: "Phosphor Fill" },
  { name: "x", label: "X", orientable: false, category: "shapes", source: "Phosphor Fill" },

  { name: "person", label: "Person", orientable: false, category: "animals", source: "Phosphor Fill" },
  { name: "walker", label: "Walker", orientable: true, category: "animals", source: "Phosphor Fill", sourceHeadingDegrees: 90 },
  { name: "turtle", label: "Turtle", orientable: true, category: "animals", sourceHeadingDegrees: 90 },
  { name: "ant", label: "Ant", orientable: true, category: "animals", sourceHeadingDegrees: 90 },
  { name: "bug", label: "Bug", orientable: true, category: "animals", sourceHeadingDegrees: 90 },
  { name: "beetle", label: "Beetle", orientable: true, category: "animals", source: "Phosphor Fill", sourceHeadingDegrees: 0 },
  { name: "butterfly", label: "Butterfly", orientable: false, category: "animals", source: "Phosphor Fill" },
  { name: "bird", label: "Bird", orientable: true, category: "animals", source: "Phosphor Fill", sourceHeadingDegrees: 90 },
  { name: "fish", label: "Fish", orientable: true, category: "animals", source: "Phosphor Fill", sourceHeadingDegrees: 45 },
  { name: "rabbit", label: "Rabbit", orientable: false, category: "animals", source: "Phosphor Fill" },
  { name: "cat", label: "Cat", orientable: false, category: "animals", source: "Phosphor Fill" },
  { name: "dog", label: "Dog", orientable: false, category: "animals", source: "Phosphor Fill" },
  { name: "cow", label: "Cow", orientable: false, category: "animals", source: "Phosphor Fill" },
  { name: "horse", label: "Horse", orientable: true, category: "animals", source: "Phosphor Fill", sourceHeadingDegrees: 270 },
  { name: "sheep", label: "Sheep", orientable: false, category: "animals" },
  { name: "paw", label: "Paw", orientable: false, category: "animals", source: "Phosphor Fill" },
  { name: "alien", label: "Alien", orientable: false, category: "animals", source: "Phosphor Fill" },
  { name: "virus", label: "Virus", orientable: false, category: "animals", source: "Phosphor Fill" },

  { name: "plant", label: "Plant", orientable: false, category: "nature", source: "Phosphor Fill" },
  { name: "leaf", label: "Leaf", orientable: true, category: "nature", source: "Phosphor Fill", sourceHeadingDegrees: 45 },
  { name: "tree", label: "Tree", orientable: false, category: "nature", source: "Phosphor Fill" },
  { name: "evergreen", label: "Evergreen", orientable: false, category: "nature", source: "Phosphor Fill" },
  { name: "flower", label: "Flower", orientable: false, category: "nature", source: "Phosphor Fill" },
  { name: "cactus", label: "Cactus", orientable: false, category: "nature", source: "Phosphor Fill" },
  { name: "acorn", label: "Acorn", orientable: false, category: "nature", source: "Phosphor Fill" },
  { name: "fire", label: "Fire", orientable: false, category: "nature", source: "Phosphor Fill" },
  { name: "drop", label: "Drop", orientable: false, category: "nature", source: "Phosphor Fill" },
  { name: "skull", label: "Skull", orientable: false, category: "nature", source: "Phosphor Fill" },
  { name: "bone", label: "Bone", orientable: true, category: "nature", source: "Phosphor Fill", sourceHeadingDegrees: 45 },
  { name: "dna", label: "DNA", orientable: false, category: "nature", source: "Phosphor Fill" },

  { name: "car", label: "Car", orientable: true, category: "engineering", sourceHeadingDegrees: 90 },
  { name: "ship", label: "Ship", orientable: true, category: "engineering", sourceHeadingDegrees: 90 },
  { name: "airplane", label: "Airplane", orientable: true, category: "engineering", source: "Phosphor Fill", sourceHeadingDegrees: 45 },
  { name: "truck", label: "Truck", orientable: true, category: "engineering", source: "Phosphor Fill", sourceHeadingDegrees: 90 },
  { name: "train", label: "Train", orientable: false, category: "engineering", source: "Phosphor Fill" },
  { name: "drone", label: "Drone", orientable: false, category: "engineering", source: "Phosphor Fill" },
  { name: "robot", label: "Robot", orientable: false, category: "engineering", source: "Phosphor Fill" },
  { name: "house", label: "House", orientable: false, category: "engineering", source: "Phosphor Fill" },
  { name: "barn", label: "Barn", orientable: false, category: "engineering", source: "Phosphor Fill" },
  { name: "factory", label: "Factory", orientable: false, category: "engineering", source: "Phosphor Fill" },
  { name: "warehouse", label: "Warehouse", orientable: false, category: "engineering", source: "Phosphor Fill" },
] as const;

export const TURTLE_SPRITE_PREFIX = "sprite:";

/** Fraction of the style color blended into sprite palette colors. */
const SPRITE_ACCENT_STRENGTH = 0.25;

/**
 * Returns the final fill/stroke color for one palette entry of a sprite.
 * Implemented as a color mix so it is safe on shared canvases (the canvas
 * fallback draws the whole board on one surface, where `source-atop`
 * compositing would bleed onto previously drawn content). For opaque pixels
 * this is equivalent to overlaying the accent at the same alpha.
 */
type SpritePaint = (baseColor: string) => string;

interface TurtleSpriteArt {
  label: string;
  orientable: boolean;
  draw: (context: CanvasRenderingContext2D, radius: number, paint: SpritePaint) => void;
}

const TURTLE_SPRITE_ART: Record<string, TurtleSpriteArt> = {
  ant: { label: "Ant", orientable: true, draw: drawSpriteAnt },
  sheep: { label: "Sheep", orientable: false, draw: drawSpriteSheep },
  wolf: { label: "Wolf", orientable: true, draw: drawSpriteWolf },
  bird: { label: "Bird", orientable: true, draw: drawSpriteBird },
  fish: { label: "Fish", orientable: true, draw: drawSpriteFish },
  butterfly: { label: "Butterfly", orientable: false, draw: drawSpriteButterfly },
  bee: { label: "Bee", orientable: true, draw: drawSpriteBee },
  beetle: { label: "Beetle", orientable: true, draw: drawSpriteBeetle },
  frog: { label: "Frog", orientable: false, draw: drawSpriteFrog },
  mouse: { label: "Mouse", orientable: true, draw: drawSpriteMouse },
  fox: { label: "Fox", orientable: true, draw: drawSpriteFox },
  turtle: { label: "Turtle", orientable: true, draw: drawSpriteTurtle },
  car: { label: "Car", orientable: true, draw: drawSpriteCar },
};

export const TURTLE_SPRITE_DEFINITIONS: readonly TurtleIconDefinition[] = Object.entries(
  TURTLE_SPRITE_ART,
).map(([name, art]) => ({
  name: `${TURTLE_SPRITE_PREFIX}${name}`,
  label: art.label,
  orientable: art.orientable,
  category: "sprites" as const,
  multicolor: true,
  // Sprites are authored facing east (canvas +x), like the hand-drawn icons.
  sourceHeadingDegrees: 90,
}));

export const TURTLE_SPRITE_NAMES: readonly string[] = TURTLE_SPRITE_DEFINITIONS.map(
  (definition) => definition.name,
);

function getTurtleSpriteArt(shape: string | undefined) {
  if (!shape || !shape.startsWith(TURTLE_SPRITE_PREFIX)) {
    return undefined;
  }

  return TURTLE_SPRITE_ART[shape.slice(TURTLE_SPRITE_PREFIX.length)];
}

/** True when the (possibly un-normalized) shape resolves to a multicolor sprite. */
export function isMulticolorTurtleShape(shape?: string | null) {
  return getTurtleSpriteArt(normalizeTurtleShapeName(shape)) !== undefined;
}

const ICONS_BY_NAME = new Map(
  [...TURTLE_ICON_DEFINITIONS, ...TURTLE_SPRITE_DEFINITIONS].map(
    (icon) => [icon.name, icon] as const,
  ),
);
const ICON_ALIASES = new Map<string, string>([
  ["", "triangle"],
  ["default", "triangle"],
  ["triangle", "triangle"],
  ["person", "person"],
  ["human", "person"],
  ["walker", "walker"],
  ["walking", "walker"],
  ["arrow", "arrow"],
  ["dart", "dart"],
  ["kite", "kite"],
  ["pentagon", "pentagon"],
  ["star", "star"],
  ["target", "target"],
  ["crosshair", "target"],
  ["x", "x"],
  ["cross", "x"],
  ["turtle", "turtle"],
  ["ant", "ant"],
  ["bug", "bug"],
  ["beetle", "beetle"],
  ["bug-beetle", "beetle"],
  ["butterfly", "butterfly"],
  ["bird", "bird"],
  ["fish", "fish"],
  ["rabbit", "rabbit"],
  ["cat", "cat"],
  ["dog", "dog"],
  ["wolf", "dog"],
  ["cow", "cow"],
  ["horse", "horse"],
  ["paw", "paw"],
  ["paw-print", "paw"],
  ["alien", "alien"],
  ["virus", "virus"],
  ["pathogen", "virus"],
  ["plant", "plant"],
  ["sprout", "plant"],
  ["leaf", "leaf"],
  ["tree", "tree"],
  ["evergreen", "evergreen"],
  ["pine", "evergreen"],
  ["flower", "flower"],
  ["cactus", "cactus"],
  ["acorn", "acorn"],
  ["fire", "fire"],
  ["flame", "fire"],
  ["drop", "drop"],
  ["water", "drop"],
  ["skull", "skull"],
  ["bone", "bone"],
  ["dna", "dna"],
  ["gene", "dna"],
  ["car", "car"],
  ["airplane", "airplane"],
  ["plane", "airplane"],
  ["aircraft", "airplane"],
  ["truck", "truck"],
  ["train", "train"],
  ["ship", "ship"],
  ["boat", "ship"],
  ["drone", "drone"],
  ["quadcopter", "drone"],
  ["robot", "robot"],
  ["house", "house"],
  ["home", "house"],
  ["barn", "barn"],
  ["factory", "factory"],
  ["building", "factory"],
  ["warehouse", "warehouse"],
  ["circle", "circle"],
  ["square", "square"],
  ["diamond", "diamond"],
  ["hex", "hex"],
  ["hexagon", "hex"],
  ["sheep", "sheep"],
]);

interface SvgPathIcon {
  path: string;
  scale?: number;
}

// Path data is from Phosphor Icons Fill, MIT licensed: https://github.com/phosphor-icons/core
const SVG_PATH_ICONS: Record<string, SvgPathIcon> = {
  acorn: {
    path: "M232,104a56.06,56.06,0,0,0-56-56H136a24,24,0,0,1,24-24,8,8,0,0,0,0-16,40,40,0,0,0-40,40H80a56.06,56.06,0,0,0-56,56,16,16,0,0,0,8,13.84V128c0,35.53,33.12,62.12,59.74,83.49C103.66,221.07,120,234.18,120,240a8,8,0,0,0,16,0c0-5.82,16.34-18.93,28.26-28.51C190.88,190.12,224,163.53,224,128V117.84A16,16,0,0,0,232,104Zm-77.75,95c-10.62,8.52-20,16-26.25,23.37-6.25-7.32-15.63-14.85-26.25-23.37C77.8,179.79,48,155.86,48,128v-8H208v8C208,155.86,178.2,179.79,154.25,199Z",
  },
  airplane: {
    path: "M215.52,197.26a8,8,0,0,1-1.86,8.39l-24,24A8,8,0,0,1,184,232a7.09,7.09,0,0,1-.79,0,8,8,0,0,1-5.87-3.52l-44.07-66.12L112,183.59V208a8,8,0,0,1-2.34,5.65s-14,14.06-15.88,15.88A7.91,7.91,0,0,1,91,231.41a8,8,0,0,1-10.41-4.35l-.06-.15-14.7-36.76L29,175.42a8,8,0,0,1-2.69-13.08l16-16A8,8,0,0,1,48,144H72.4l21.27-21.27L27.56,78.65a8,8,0,0,1-1.22-12.32l24-24a8,8,0,0,1,8.39-1.86l85.94,31.25L176.2,40.19a28,28,0,0,1,39.6,39.6l-31.53,31.53Z",
  },
  alien: {
    path: "M128,16a96.11,96.11,0,0,0-96,96c0,24,12.56,55.06,33.61,83,21.18,28.15,44.5,45,62.39,45s41.21-16.81,62.39-45c21.05-28,33.61-59,33.61-83A96.11,96.11,0,0,0,128,16ZM64,116a12,12,0,0,1,12-12,36,36,0,0,1,36,36,12,12,0,0,1-12,12A36,36,0,0,1,64,116Zm80,84H112a8,8,0,0,1,0-16h32a8,8,0,0,1,0,16Zm12-48a12,12,0,0,1-12-12,36,36,0,0,1,36-36,12,12,0,0,1,12,12A36,36,0,0,1,156,152Z",
  },
  barn: {
    path: "M240,192h-8V130.57l1.49,2.08a8,8,0,1,0,13-9.3l-40-56a8,8,0,0,0-2-1.94L137,18.77l-.1-.07a16,16,0,0,0-17.76,0l-.1.07L51.45,65.42a8,8,0,0,0-2,1.94l-40,56a8,8,0,1,0,13,9.3L24,130.57V192H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM112,80h32a8,8,0,1,1,0,16H112a8,8,0,1,1,0-16Zm52.64,40L128,146.17,91.36,120ZM72,125.83,114.24,156,72,186.17ZM91.36,192,128,165.83,164.64,192ZM184,186.17,141.76,156,184,125.83Z",
  },
  beetle: {
    path: "M224,120H208V104h16a8,8,0,0,1,0,16ZM32,104a8,8,0,0,0,0,16H48V104Zm176,56c0,2.7-.14,5.37-.4,8H224a8,8,0,0,1,0,16H204.32a80,80,0,0,1-152.64,0H32a8,8,0,0,1,0-16H48.4c-.26-2.63-.4-5.3-.4-8v-8H32a8,8,0,0,1,0-16H48V120H208v16h16a8,8,0,0,1,0,16H208Zm-72-16a8,8,0,0,0-16,0v64a8,8,0,0,0,16,0ZM69.84,57.15A79.76,79.76,0,0,0,48.4,104H207.6a79.76,79.76,0,0,0-21.44-46.85l19.5-19.49a8,8,0,0,0-11.32-11.32l-20.29,20.3a79.74,79.74,0,0,0-92.1,0L61.66,26.34A8,8,0,0,0,50.34,37.66Z",
  },
  bird: {
    path: "M236.44,73.34,213.21,57.86A60,60,0,0,0,156,16h-.29C122.79,16.16,96,43.47,96,76.89V96.63L11.63,197.88l-.1.12A16,16,0,0,0,24,224h88A104.11,104.11,0,0,0,216,120V100.28l20.44-13.62a8,8,0,0,0,0-13.32ZM126.15,133.12l-60,72a8,8,0,1,1-12.29-10.24l60-72a8,8,0,1,1,12.29,10.24ZM164,80a12,12,0,1,1,12-12A12,12,0,0,1,164,80Z",
  },
  bone: {
    path: "M231.12,107.72a35.91,35.91,0,0,1-46.19,6.8.14.14,0,0,0-.1,0l-70.35,70.36s0,0,0,.08a36,36,0,1,1-66.37,22.92,36,36,0,1,1,22.92-66.37.14.14,0,0,0,.1,0l70.35-70.36s0,0,0-.08a36,36,0,1,1,66.37-22.92,36,36,0,0,1,23.27,59.57Z",
  },
  bug: {
    path: "M168,92a12,12,0,1,1-12-12A12,12,0,0,1,168,92ZM100,80a12,12,0,1,0,12,12A12,12,0,0,0,100,80Zm116,64A87.76,87.76,0,0,1,213,167l22.24,9.72A8,8,0,0,1,232,192a7.89,7.89,0,0,1-3.2-.67L207.38,182a88,88,0,0,1-158.76,0L27.2,191.33A7.89,7.89,0,0,1,24,192a8,8,0,0,1-3.2-15.33L43,167A87.76,87.76,0,0,1,40,144v-8H16a8,8,0,0,1,0-16H40v-8a87.76,87.76,0,0,1,3-23L20.8,79.33a8,8,0,1,1,6.4-14.66L48.62,74a88,88,0,0,1,158.76,0l21.42-9.36a8,8,0,0,1,6.4,14.66L213,89.05a87.76,87.76,0,0,1,3,23v8h24a8,8,0,0,1,0,16H216Zm-80,0a8,8,0,0,0-16,0v64a8,8,0,0,0,16,0Zm64-32a72,72,0,0,0-144,0v8H200Z",
  },
  butterfly: {
    path: "M128,100.17a108.42,108.42,0,0,0-8-12.64V56a8,8,0,0,1,16,0V87.53A108.42,108.42,0,0,0,128,100.17ZM232.7,50.48C229,45.7,221.84,40,209,40c-16.85,0-38.46,11.28-57.81,30.16A140.07,140.07,0,0,0,136,87.53V180a8,8,0,0,1-16,0V87.53a140.07,140.07,0,0,0-15.15-17.37C85.49,51.28,63.88,40,47,40,34.16,40,27,45.7,23.3,50.48c-6.82,8.77-12.18,24.08-.21,71.2,6.05,23.83,19.51,33,30.63,36.42A44,44,0,0,0,128,205.27a44,44,0,0,0,74.28-47.17c11.12-3.4,24.57-12.59,30.63-36.42C239.63,95.24,244.85,66.1,232.7,50.48Z",
  },
  cactus: {
    path: "M224,216a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H88V136H80A64.07,64.07,0,0,1,16,72,24.07,24.07,0,0,1,40.08,48h.4A23.55,23.55,0,0,1,64,71.52V72h0A16,16,0,0,0,80,88h8V56a40,40,0,0,1,80,0v72h8a16,16,0,0,0,16-16h0v-.48A23.55,23.55,0,0,1,215.52,88h.4A24.07,24.07,0,0,1,240,112a64.07,64.07,0,0,1-64,64h-8v32h48A8,8,0,0,1,224,216Z",
  },
  cat: {
    path: "M222.83,33.54a16,16,0,0,0-18.14,3.15c-.14.14-.26.27-.38.41L187.05,57A111.28,111.28,0,0,0,69,57L51.69,37.1c-.12-.14-.24-.27-.38-.41a16,16,0,0,0-18.14-3.15A16.4,16.4,0,0,0,24,48.46V136c0,49,40.06,89.63,91.56,95.32a4,4,0,0,0,4.44-4v-32l-13.42-13.43a8.22,8.22,0,0,1-.41-11.37,8,8,0,0,1,11.49-.18L128,180.68l10.34-10.35a8,8,0,0,1,11.49.18,8.22,8.22,0,0,1-.41,11.37L136,195.31v32a4,4,0,0,0,4.44,4C191.94,225.62,232,185,232,136V48.46A16.4,16.4,0,0,0,222.83,33.54ZM84,152a12,12,0,1,1,12-12A12,12,0,0,1,84,152Zm20-64a8,8,0,1,1-16,0V69a8,8,0,0,1,16,0Zm32,0a8,8,0,1,1-16,0V64a8,8,0,0,1,16,0Zm16,0V69a8,8,0,0,1,16,0V88a8,8,0,1,1-16,0Zm20,64a12,12,0,1,1,12-12A12,12,0,0,1,172,152Z",
  },
  circle: {
    path: "M232,128A104,104,0,1,1,128,24,104.13,104.13,0,0,1,232,128Z",
  },
  cow: {
    path: "M104,192a8,8,0,0,1-8,8H80a8,8,0,0,1,0-16H96A8,8,0,0,1,104,192Zm72-8H160a8,8,0,0,0,0,16h16a8,8,0,0,0,0-16Zm68.39-61.88A16,16,0,0,1,232,128H200v32a40,40,0,0,1-24,72H80a40,40,0,0,1-24-72V128H24A16,16,0,0,1,8.31,109,56.13,56.13,0,0,1,63.22,64h1.64A55.83,55.83,0,0,1,48,24a8,8,0,0,1,16,0,40,40,0,0,0,40,40h48a40,40,0,0,0,40-40,8,8,0,0,1,16,0,55.83,55.83,0,0,1-16.86,40h1.64a56.13,56.13,0,0,1,54.91,45A15.82,15.82,0,0,1,244.39,122.12ZM144,124a12,12,0,1,0,12-12A12,12,0,0,0,144,124Zm-56,0a12,12,0,1,0,12-12A12,12,0,0,0,88,124ZM56,112v-8a39.81,39.81,0,0,1,8-24h-.8A40.09,40.09,0,0,0,24,112Zm144,80a24,24,0,0,0-24-24H80a24,24,0,0,0,0,48h96A24,24,0,0,0,200,192Zm32-80a40.08,40.08,0,0,0-39.2-32H192a39.81,39.81,0,0,1,8,24v8Z",
  },
  diamond: {
    path: "M240,128a15.85,15.85,0,0,1-4.67,11.28l-96.05,96.06a16,16,0,0,1-22.56,0h0l-96-96.06a16,16,0,0,1,0-22.56l96.05-96.06a16,16,0,0,1,22.56,0l96.05,96.06A15.85,15.85,0,0,1,240,128Z",
  },
  dog: {
    path: "M239.71,125l-16.42-88a16,16,0,0,0-19.61-12.58l-.31.09L150.85,40h-45.7L52.63,24.56l-.31-.09A16,16,0,0,0,32.71,37.05L16.29,125a15.77,15.77,0,0,0,9.12,17.52A16.26,16.26,0,0,0,32.12,144,15.48,15.48,0,0,0,40,141.84V184a40,40,0,0,0,40,40h96a40,40,0,0,0,40-40V141.85a15.5,15.5,0,0,0,7.87,2.16,16.31,16.31,0,0,0,6.72-1.47A15.77,15.77,0,0,0,239.71,125ZM176,208H136V195.31l13.66-13.65a8,8,0,0,0-11.32-11.32L128,180.69l-10.34-10.35a8,8,0,0,0-11.32,11.32L120,195.31V208H80a24,24,0,0,1-24-24V123.11L107.93,56h40.14L200,123.11V184A24,24,0,0,1,176,208Zm-72-68a12,12,0,1,1-12-12A12,12,0,0,1,104,140Zm72,0a12,12,0,1,1-12-12A12,12,0,0,1,176,140Z",
  },
  dna: {
    path: "M200,204.5V232a8,8,0,0,1-16,0V204.5a63.67,63.67,0,0,0-35.38-57.25l-48.4-24.19A79.58,79.58,0,0,1,56,51.5V24a8,8,0,0,1,16,0V51.5a63.67,63.67,0,0,0,35.38,57.25l48.4,24.19A79.58,79.58,0,0,1,200,204.5ZM163.18,192H83.91a8,8,0,0,1-8-8.53A8.18,8.18,0,0,1,84.18,176H149.7a4,4,0,0,0,2.75-6.9,48.24,48.24,0,0,0-11-7.53L94.8,138.23a4,4,0,0,0-4.08.3A79.51,79.51,0,0,0,56,204.5v27.23A8.17,8.17,0,0,0,63.47,240,8,8,0,0,0,72,232V216h92a4,4,0,0,0,4-4v-7.5a48.76,48.76,0,0,0-.9-9.32A4,4,0,0,0,163.18,192ZM191.47,16A8.17,8.17,0,0,0,184,24.27V40H92a4,4,0,0,0-4,4v7.5a48.76,48.76,0,0,0,.9,9.32A4,4,0,0,0,92.82,64h79a8.18,8.18,0,0,1,8.25,7.47,8,8,0,0,1-8,8.53H106.3a4,4,0,0,0-2.75,6.9,48.24,48.24,0,0,0,11,7.53l46.67,23.34a4,4,0,0,0,4.08-.3A79.51,79.51,0,0,0,200,51.5V24A8,8,0,0,0,191.47,16Z",
  },
  drone: {
    path: "M189.66,77.66,160,107.31v41.38l29.66,29.65a8,8,0,0,1-11.32,11.32L148.69,160H107.31L77.66,189.66a8,8,0,0,1-11.32-11.32L96,148.69V107.31L66.34,77.66A8,8,0,0,1,77.66,66.34L107.31,96h41.38l29.65-29.66a8,8,0,0,1,11.32,11.32Zm-46.28-6.12a8,8,0,0,0,10.21-4.87,28,28,0,1,1,35.74,35.74A8,8,0,0,0,192,118a7.86,7.86,0,0,0,2.67-.46,44,44,0,1,0-56.16-56.16A8,8,0,0,0,143.38,71.54Zm51.29,67a8,8,0,0,0-5.34,15.08,28,28,0,1,1-35.74,35.74,8,8,0,0,0-15.08,5.34,44,44,0,1,0,56.16-56.16Zm-82,46a8,8,0,0,0-10.21,4.87,28,28,0,1,1-35.74-35.74,8,8,0,0,0-5.34-15.08,44,44,0,1,0,56.16,56.16A8,8,0,0,0,112.62,184.46Zm-51.29-67A7.86,7.86,0,0,0,64,118a8,8,0,0,0,2.67-15.54,28,28,0,1,1,35.74-35.74,8,8,0,1,0,15.08-5.34,44,44,0,1,0-56.16,56.16Z",
  },
  drop: {
    path: "M174,47.75a254.19,254.19,0,0,0-41.45-38.3,8,8,0,0,0-9.18,0A254.19,254.19,0,0,0,82,47.75C54.51,79.32,40,112.6,40,144a88,88,0,0,0,176,0C216,112.6,201.49,79.32,174,47.75Zm9.85,105.59a57.6,57.6,0,0,1-46.56,46.55A8.75,8.75,0,0,1,136,200a8,8,0,0,1-1.32-15.89c16.57-2.79,30.63-16.85,33.44-33.45a8,8,0,0,1,15.78,2.68Z",
  },
  factory: {
    path: "M232,208h-8V136c0-.05,0-.09,0-.14s0-.29,0-.43,0-.28,0-.41a.76.76,0,0,0,0-.15l-15-105.13A16.08,16.08,0,0,0,193.06,16H174.94A16.08,16.08,0,0,0,159.1,29.74l-11.56,80.91L108.8,81.6A8,8,0,0,0,96,88v32L44.8,81.6A8,8,0,0,0,32,88V208H24a8,8,0,0,0,0,16H232a8,8,0,0,0,0-16ZM108,184H80a8,8,0,0,1,0-16h28a8,8,0,0,1,0,16Zm68,0H148a8,8,0,0,1,0-16h28a8,8,0,0,1,0,16Zm-5.33-56-8.53-6.4L174.94,32h18.12l13.72,96Z",
  },
  fire: {
    path: "M143.38,17.85a8,8,0,0,0-12.63,3.41l-22,60.41L84.59,58.26a8,8,0,0,0-11.93.89C51,87.53,40,116.08,40,144a88,88,0,0,0,176,0C216,84.55,165.21,36,143.38,17.85Zm40.51,135.49a57.6,57.6,0,0,1-46.56,46.55A7.65,7.65,0,0,1,136,200a8,8,0,0,1-1.32-15.89c16.57-2.79,30.63-16.85,33.44-33.45a8,8,0,0,1,15.78,2.68Z",
  },
  fish: {
    path: "M168,76a12,12,0,1,1-12-12A12,12,0,0,1,168,76Zm48.72,67.64c-19.37,34.9-55.44,53.76-107.24,56.1l-22,51.41A8,8,0,0,1,80.1,256l-.51,0a8,8,0,0,1-7.19-5.78L57.6,198.39,5.8,183.56a8,8,0,0,1-1-15.05l51.41-22c2.35-51.78,21.21-87.84,56.09-107.22,24.75-13.74,52.74-15.84,71.88-15.18,18.64.64,36,4.27,38.86,6a8,8,0,0,1,2.83,2.83c1.69,2.85,5.33,20.21,6,38.85C232.55,90.89,230.46,118.89,216.72,143.64Zm-4.3-100.07c-14.15-3-64.1-11-100.3,14.75a81.21,81.21,0,0,0-16,15.07,36,36,0,0,0,39.35,38.44,8,8,0,0,1,8.73,8.73,36,36,0,0,0,38.47,39.34,80.81,80.81,0,0,0,15-16C223.42,107.73,215.42,57.74,212.42,43.57Z",
  },
  flower: {
    path: "M210.35,129.36c-.81-.47-1.7-.92-2.62-1.36.92-.44,1.81-.89,2.62-1.36a40,40,0,1,0-40-69.28c-.81.47-1.65,1-2.48,1.59.08-1,.13-2,.13-3a40,40,0,0,0-80,0c0,.94,0,1.94.13,3-.83-.57-1.67-1.12-2.48-1.59a40,40,0,1,0-40,69.28c.81.47,1.7.92,2.62,1.36-.92.44-1.81.89-2.62,1.36a40,40,0,1,0,40,69.28c.81-.47,1.65-1,2.48-1.59-.08,1-.13,2-.13,2.95a40,40,0,0,0,80,0c0-.94-.05-1.94-.13-2.95.83.57,1.67,1.12,2.48,1.59A39.79,39.79,0,0,0,190.29,204a40.43,40.43,0,0,0,10.42-1.38,40,40,0,0,0,9.64-73.28ZM128,156a28,28,0,1,1,28-28A28,28,0,0,1,128,156Z",
  },
  hex: {
    path: "M232,80.18v95.64a16,16,0,0,1-8.32,14l-88,48.17a15.88,15.88,0,0,1-15.36,0l-88-48.17a16,16,0,0,1-8.32-14V80.18a16,16,0,0,1,8.32-14l88-48.17a15.88,15.88,0,0,1,15.36,0l88,48.17A16,16,0,0,1,232,80.18Z",
  },
  house: {
    path: "M224,120v96a8,8,0,0,1-8,8H160a8,8,0,0,1-8-8V164a4,4,0,0,0-4-4H108a4,4,0,0,0-4,4v52a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V120a16,16,0,0,1,4.69-11.31l80-80a16,16,0,0,1,22.62,0l80,80A16,16,0,0,1,224,120Z",
  },
  horse: {
    path: "M202.05,55A103.24,103.24,0,0,0,128,24h-8a8,8,0,0,0-8,8V59.53L11.81,121.19a8,8,0,0,0-2.59,11.05l13.78,22,.3.43a31.84,31.84,0,0,0,31.34,12.83c13.93-2.36,38.62-6.54,61.4,3.29l-26.6,36.57A84.71,84.71,0,0,1,69.34,194,8,8,0,1,0,58.67,206a103.32,103.32,0,0,0,69.26,26l2.17,0a104,104,0,0,0,72-177ZM124,112a12,12,0,1,1,12-12A12,12,0,0,1,124,112Z",
  },
  leaf: {
    path: "M223.45,40.07a8,8,0,0,0-7.52-7.52C139.8,28.08,78.82,51,52.82,94a87.09,87.09,0,0,0-12.76,49A101.72,101.72,0,0,0,46.7,175.2a4,4,0,0,0,6.61,1.43l85-86.3a8,8,0,0,1,11.32,11.32L56.74,195.94,42.55,210.13a8.2,8.2,0,0,0-.6,11.1,8,8,0,0,0,11.71.43l16.79-16.79c14.14,6.84,28.41,10.57,42.56,11.07q1.67.06,3.33.06A86.93,86.93,0,0,0,162,203.18C205,177.18,227.93,116.21,223.45,40.07Z",
  },
  paw: {
    path: "M240,108a28,28,0,1,1-28-28A28,28,0,0,1,240,108ZM72,108a28,28,0,1,0-28,28A28,28,0,0,0,72,108ZM92,88A28,28,0,1,0,64,60,28,28,0,0,0,92,88Zm72,0a28,28,0,1,0-28-28A28,28,0,0,0,164,88Zm23.12,60.86a35.3,35.3,0,0,1-16.87-21.14,44,44,0,0,0-84.5,0A35.25,35.25,0,0,1,69,148.82,40,40,0,0,0,88,224a39.48,39.48,0,0,0,15.52-3.13,64.09,64.09,0,0,1,48.87,0,40,40,0,0,0,34.73-72Z",
  },
  pentagon: {
    path: "M231.26,105.19l-32,107.54-.06.17A15.94,15.94,0,0,1,184,224H72A15.94,15.94,0,0,1,56.8,212.9l-.06-.17-32-107.54a16,16,0,0,1,5.7-17.63l87.92-68.31.18-.14a15.93,15.93,0,0,1,18.92,0l.18.14,87.92,68.31A16,16,0,0,1,231.26,105.19Z",
  },
  person: {
    path: "M100,36a28,28,0,1,1,28,28A28,28,0,0,1,100,36ZM215.42,140.78l-45.25-51.3a28,28,0,0,0-21-9.48H106.83a28,28,0,0,0-21,9.48l-45.25,51.3a16,16,0,0,0,22.56,22.69L89,142.7l-19.7,74.88a16,16,0,0,0,29.08,13.35L128,180l29.58,51a16,16,0,0,0,29.08-13.35L167,142.7l25.9,20.77a16,16,0,0,0,22.56-22.69Z",
  },
  plant: {
    path: "M205.41,159.07a60.9,60.9,0,0,1-31.83,8.86,71.71,71.71,0,0,1-27.36-5.66A55.55,55.55,0,0,0,136,194.51V224a8,8,0,0,1-8.53,8,8.18,8.18,0,0,1-7.47-8.25V211.31L81.38,172.69A52.5,52.5,0,0,1,63.44,176a45.82,45.82,0,0,1-23.92-6.67C17.73,156.09,6,125.62,8.27,87.79a8,8,0,0,1,7.52-7.52c37.83-2.23,68.3,9.46,81.5,31.25A46,46,0,0,1,103.74,140a4,4,0,0,1-6.89,2.43l-19.2-20.1a8,8,0,0,0-11.31,11.31l53.88,55.25c.06-.78.13-1.56.21-2.33a68.56,68.56,0,0,1,18.64-39.46l50.59-53.46a8,8,0,0,0-11.31-11.32l-49,51.82a4,4,0,0,1-6.78-1.74c-4.74-17.48-2.65-34.88,6.4-49.82,17.86-29.48,59.42-45.26,111.18-42.22a8,8,0,0,1,7.52,7.52C250.67,99.65,234.89,141.21,205.41,159.07Z",
  },
  rabbit: {
    path: "M199.28,149.8A71.58,71.58,0,0,0,193,129c19-37.94,30.45-88.28,17.34-110A22,22,0,0,0,190.94,8c-14.12,0-26,11.89-36.44,36.36-6.22,14.62-10.85,31.32-14,44.74a71.8,71.8,0,0,0-25,0c-3.13-13.42-7.76-30.12-14-44.74C91.1,19.89,79.18,8,65.06,8A22,22,0,0,0,45.64,19.08C32.53,40.76,44,91.1,63,129a71.58,71.58,0,0,0-6.26,20.76A52,52,0,1,0,128,225.52l-21.12-19.37a8,8,0,1,1,10.24-12.3L128,202.9l10.88-9.05a8,8,0,0,1,10.24,12.3L128,225.52a52,52,0,1,0,71.28-75.72Zm-126-36.53A218.45,218.45,0,0,1,58.4,67.08c-3.49-18.13-3.15-33,.93-39.72A6,6,0,0,1,65.06,24c6.61,0,14.52,9.7,21.72,26.62,5.93,13.94,10.35,30.12,13.33,43a71.72,71.72,0,0,0-26.88,19.64ZM100,176a12,12,0,1,1,12-12A12,12,0,0,1,100,176Zm56,0a12,12,0,1,1,12-12A12,12,0,0,1,156,176Zm20.55-69.17a71.89,71.89,0,0,0-20.66-13.2c3-12.89,7.4-29.07,13.33-43C176.42,33.7,184.33,24,190.94,24a6,6,0,0,1,5.73,3.36c4.08,6.74,4.42,21.59.93,39.72a218.45,218.45,0,0,1-14.83,46.19A72.6,72.6,0,0,0,176.55,106.83Z",
  },
  robot: {
    path: "M200,48H136V16a8,8,0,0,0-16,0V48H56A32,32,0,0,0,24,80V192a32,32,0,0,0,32,32H200a32,32,0,0,0,32-32V80A32,32,0,0,0,200,48ZM172,96a12,12,0,1,1-12,12A12,12,0,0,1,172,96ZM96,184H80a16,16,0,0,1,0-32H96ZM84,120a12,12,0,1,1,12-12A12,12,0,0,1,84,120Zm60,64H112V152h32Zm32,0H160V152h16a16,16,0,0,1,0,32Z",
  },
  skull: {
    path: "M128,16C70.65,16,24,60.86,24,116c0,34.1,18.27,66,48,84.28V216a16,16,0,0,0,16,16h8a4,4,0,0,0,4-4V200.27a8.17,8.17,0,0,1,7.47-8.25,8,8,0,0,1,8.53,8v28a4,4,0,0,0,4,4h16a4,4,0,0,0,4-4V200.27a8.17,8.17,0,0,1,7.47-8.25,8,8,0,0,1,8.53,8v28a4,4,0,0,0,4,4h8a16,16,0,0,0,16-16V200.28C213.73,182,232,150.1,232,116,232,60.86,185.35,16,128,16ZM92,152a20,20,0,1,1,20-20A20,20,0,0,1,92,152Zm72,0a20,20,0,1,1,20-20A20,20,0,0,1,164,152Z",
  },
  square: {
    path: "M224,48V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48Z",
  },
  star: {
    path: "M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z",
  },
  target: {
    path: "M221.87,83.16A104.1,104.1,0,1,1,195.67,49l22.67-22.68a8,8,0,0,1,11.32,11.32L167.6,99.71h0l-37.71,37.71-23.95,23.95a40,40,0,0,0,62-35.67,8,8,0,1,1,16-.9,56,56,0,0,1-95.5,42.79h0a56,56,0,0,1,73.13-84.43L184.3,60.39a87.88,87.88,0,1,0,23.13,29.67,8,8,0,0,1,14.44-6.9Z",
  },
  train: {
    path: "M184,24H72A32,32,0,0,0,40,56V184a32,32,0,0,0,32,32h8L65.6,235.2a8,8,0,1,0,12.8,9.6L100,216h56l21.6,28.8a8,8,0,1,0,12.8-9.6L176,216h8a32,32,0,0,0,32-32V56A32,32,0,0,0,184,24Zm0,176H72a16,16,0,0,1-16-16V136H200v48A16,16,0,0,1,184,200ZM96,172a12,12,0,1,1-12-12A12,12,0,0,1,96,172Zm88,0a12,12,0,1,1-12-12A12,12,0,0,1,184,172Z",
  },
  tree: {
    path: "M128,187.85a72.44,72.44,0,0,0,8,4.62V232a8,8,0,0,1-16,0V192.47A72.44,72.44,0,0,0,128,187.85ZM198.1,62.59a76,76,0,0,0-140.2,0A71.71,71.71,0,0,0,16,127.8C15.9,166,48,199,86.14,200A72.22,72.22,0,0,0,120,192.47V156.94L76.42,135.16a8,8,0,1,1,7.16-14.32L120,139.06V88a8,8,0,0,1,16,0v27.06l36.42-18.22a8,8,0,1,1,7.16,14.32L136,132.94v59.53A72.17,72.17,0,0,0,168,200l1.82,0C208,199,240.11,166,240,127.8A71.71,71.71,0,0,0,198.1,62.59Z",
  },
  evergreen: {
    path: "M231.19,195.51A8,8,0,0,1,224,200H136v40a8,8,0,0,1-16,0V200H32a8,8,0,0,1-6.31-12.91l46-59.09H48a8,8,0,0,1-6.34-12.88l80-104a8,8,0,0,1,12.68,0l80,104A8,8,0,0,1,208,128H184.36l45.95,59.09A8,8,0,0,1,231.19,195.51Z",
  },
  truck: {
    path: "M255.43,117l-14-35A15.93,15.93,0,0,0,226.58,72H192V64a8,8,0,0,0-8-8H32A16,16,0,0,0,16,72V184a16,16,0,0,0,16,16H49a32,32,0,0,0,62,0h50a32,32,0,0,0,62,0h17a16,16,0,0,0,16-16V120A8.13,8.13,0,0,0,255.43,117ZM80,208a16,16,0,1,1,16-16A16,16,0,0,1,80,208ZM32,136V72H176v64Zm160,72a16,16,0,1,1,16-16A16,16,0,0,1,192,208Zm0-96V88h34.58l9.6,24Z",
  },
  virus: {
    path: "M240,120H223.66a95.52,95.52,0,0,0-22.39-53.95l12.39-12.39a8,8,0,0,0-11.32-11.32L190,54.73A95.52,95.52,0,0,0,136,32.34V16a8,8,0,0,0-16,0V32.34A95.52,95.52,0,0,0,66.05,54.73L53.66,42.34A8,8,0,0,0,42.34,53.66L54.73,66.05a95.52,95.52,0,0,0-22.39,54H16a8,8,0,0,0,0,16H32.34A95.52,95.52,0,0,0,54.73,190L42.34,202.34a8,8,0,0,0,11.32,11.32l12.39-12.39a95.52,95.52,0,0,0,54,22.39V240a8,8,0,0,0,16,0V223.66A95.52,95.52,0,0,0,190,201.27l12.39,12.39a8,8,0,0,0,11.32-11.32L201.27,190A95.52,95.52,0,0,0,223.66,136H240a8,8,0,0,0,0-16ZM80,108a28,28,0,1,1,28,28A28,28,0,0,1,80,108Zm48,84a16,16,0,1,1,16-16A16,16,0,0,1,128,192Zm48-48a16,16,0,1,1,16-16A16,16,0,0,1,176,144Z",
  },
  walker: {
    path: "M120,48a32,32,0,1,1,32,32A32,32,0,0,1,120,48Zm88,88c-28.64,0-41.81-13.3-55.75-27.37-3.53-3.57-7.18-7.26-11-10.58-37-32.14-96.22,22.73-98.72,25.08a8,8,0,0,0,10.95,11.66A163.88,163.88,0,0,1,84,113c13.78-7.38,25.39-10.23,34.7-8.58L64.66,228.81a8,8,0,0,0,4.15,10.52A7.84,7.84,0,0,0,72,240a8,8,0,0,0,7.34-4.81l33.59-77.27L144,180.12V232a8,8,0,0,0,16,0V176a8,8,0,0,0-3.35-6.51l-37.2-26.57L132.88,112c2.64,2.44,5.26,5.07,8,7.84C155.05,134.19,172.69,152,208,152a8,8,0,0,0,0-16Z",
  },
  warehouse: {
    path: "M240,184h-8V57.9l9.67-2.08a8,8,0,1,0-3.35-15.64l-224,48A8,8,0,0,0,16,104a8.16,8.16,0,0,0,1.69-.18L24,102.47V184H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16Zm-56,0H72V168H184Zm0-32H72V136H184Z",
  },
  x: {
    path: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM181.66,170.34a8,8,0,0,1-11.32,11.32L128,139.31,85.66,181.66a8,8,0,0,1-11.32-11.32L116.69,128,74.34,85.66A8,8,0,0,1,85.66,74.34L128,116.69l42.34-42.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
  },
};

const SVG_PATH_CACHE = new Map<string, Path2D>();

export function normalizeTurtleShapeName(shape?: string | null) {
  const key = shape?.trim().toLowerCase() ?? "triangle";

  if (key.startsWith(TURTLE_SPRITE_PREFIX)) {
    const spriteName = key.slice(TURTLE_SPRITE_PREFIX.length).trim();
    // Unknown sprite names fall back to the default shape instead of crashing.
    return TURTLE_SPRITE_ART[spriteName]
      ? `${TURTLE_SPRITE_PREFIX}${spriteName}`
      : "triangle";
  }

  return ICON_ALIASES.get(key) ?? "triangle";
}

export function getTurtleShapeDefinition(shape?: string | null) {
  return ICONS_BY_NAME.get(normalizeTurtleShapeName(shape)) ?? ICONS_BY_NAME.get("triangle")!;
}

export function resolveTurtleAppearance(
  ...styles: Array<TurtleAppearance | null | undefined>
) {
  let shape: string | undefined;
  let orientable: boolean | undefined;

  for (const style of styles) {
    if (!style) {
      continue;
    }

    if (typeof style.shape === "string" && style.shape.trim().length > 0) {
      shape = style.shape;
    }

    if (typeof style.orientable === "boolean") {
      orientable = style.orientable;
    }
  }

  const definition = getTurtleShapeDefinition(shape);
  const resolvedOrientable = orientable ?? definition.orientable;
  const sourceHeadingDegrees =
    definition.sourceHeadingDegrees ?? TURTLE_ICON_EAST_HEADING_DEGREES;

  return {
    shape: definition.name,
    orientable: resolvedOrientable,
    definition,
    sourceHeadingDegrees,
    sourceHeadingRadians: netLogoHeadingToCanvasRadians(sourceHeadingDegrees),
    defaultHeadingDegrees: resolvedOrientable
      ? TURTLE_ICON_DEFAULT_HEADING_DEGREES
      : undefined,
    defaultHeadingRadians: resolvedOrientable
      ? TURTLE_ICON_DEFAULT_HEADING_RADIANS
      : undefined,
  };
}

export function drawTurtleIcon({
  context,
  shape,
  orientable,
  color,
  radius,
  headingRadians,
}: DrawTurtleIconOptions) {
  const appearance = resolveTurtleAppearance({ shape, orientable });

  context.save();
  context.fillStyle = color;

  if (appearance.orientable) {
    const targetHeadingRadians =
      headingRadians ?? appearance.defaultHeadingRadians ?? TURTLE_ICON_DEFAULT_HEADING_RADIANS;
    context.rotate(targetHeadingRadians - appearance.sourceHeadingRadians);
  }

  const spriteArt = getTurtleSpriteArt(appearance.shape);
  if (spriteArt) {
    spriteArt.draw(context, radius, createSpritePaint(color));
    context.restore();
    return;
  }

  if (drawSvgPathIcon(context, appearance.shape, radius)) {
    context.restore();
    return;
  }

  switch (appearance.shape) {
    case "circle":
      drawCircle(context, radius);
      break;
    case "square":
      drawSquare(context, radius);
      break;
    case "diamond":
      drawDiamond(context, radius);
      break;
    case "hex":
      drawHex(context, radius);
      break;
    case "arrow":
      drawArrow(context, radius);
      break;
    case "dart":
      drawDart(context, radius);
      break;
    case "kite":
      drawKite(context, radius);
      break;
    case "turtle":
      drawTurtle(context, radius);
      break;
    case "bug":
      drawBug(context, radius);
      break;
    case "ant":
      drawAnt(context, radius);
      break;
    case "person":
      drawPerson(context, radius);
      break;
    case "walker":
      drawWalker(context, radius);
      break;
    case "sheep":
      drawSheep(context, radius);
      break;
    case "car":
      drawCar(context, radius);
      break;
    case "ship":
      drawShip(context, radius);
      break;
    case "drone":
      drawDrone(context, radius);
      break;
    case "robot":
      drawRobot(context, radius);
      break;
    case "house":
      drawHouse(context, radius);
      break;
    case "factory":
      drawFactory(context, radius);
      break;
    case "virus":
      drawVirus(context, radius);
      break;
    case "triangle":
    default:
      drawTriangle(context, radius);
      break;
  }

  context.restore();
}

/**
 * Draws a multicolor sprite centered in a `size`×`size` box whose center is
 * the current origin. Orientable sprites face east (canvas +x). The optional
 * accent color is blended into the sprite palette at a subtle strength so
 * differently-colored breeds of the same sprite stay distinguishable.
 */
export function drawTurtleSprite(
  context: CanvasRenderingContext2D,
  name: string,
  size: number,
  accentColor?: string,
) {
  const shape = name.startsWith(TURTLE_SPRITE_PREFIX)
    ? name
    : `${TURTLE_SPRITE_PREFIX}${name}`;

  drawTurtleIcon({
    context,
    shape,
    color: accentColor ?? "",
    radius: size / 4,
    headingRadians: 0,
  });
}

export function extractTurtleAppearance(
  turtle: TurtleLike & TurtleAppearance,
  style?: StateStyle | null,
) {
  return resolveTurtleAppearance(turtle, style);
}

function drawSvgPathIcon(
  context: CanvasRenderingContext2D,
  shape: string | undefined,
  radius: number,
) {
  if (!shape) {
    return false;
  }

  const icon = SVG_PATH_ICONS[shape];
  if (!icon || typeof Path2D === "undefined") {
    return false;
  }

  let path = SVG_PATH_CACHE.get(shape);
  if (!path) {
    path = new Path2D(icon.path);
    SVG_PATH_CACHE.set(shape, path);
  }

  const scale = (radius * (icon.scale ?? 1.12)) / 128;
  context.save();
  context.scale(scale, scale);
  context.translate(-128, -128);
  context.fill(path);
  context.restore();

  return true;
}

function drawCircle(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
}

function drawSquare(context: CanvasRenderingContext2D, radius: number) {
  context.fillRect(-radius, -radius, radius * 2, radius * 2);
}

function drawDiamond(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.moveTo(0, -radius * 1.2);
  context.lineTo(radius * 1.05, 0);
  context.lineTo(0, radius * 1.2);
  context.lineTo(-radius * 1.05, 0);
  context.closePath();
  context.fill();
}

function drawHex(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.moveTo(radius * 1.08, 0);
  context.lineTo(radius * 0.54, radius * 0.94);
  context.lineTo(-radius * 0.54, radius * 0.94);
  context.lineTo(-radius * 1.08, 0);
  context.lineTo(-radius * 0.54, -radius * 0.94);
  context.lineTo(radius * 0.54, -radius * 0.94);
  context.closePath();
  context.fill();
}

function drawTriangle(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.moveTo(radius * 1.4, 0);
  context.lineTo(-radius, radius * 0.8);
  context.lineTo(-radius, -radius * 0.8);
  context.closePath();
  context.fill();
}

function drawArrow(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.moveTo(radius * 1.45, 0);
  context.lineTo(radius * 0.25, radius * 0.78);
  context.lineTo(radius * 0.25, radius * 0.32);
  context.lineTo(-radius * 1.2, radius * 0.32);
  context.lineTo(-radius * 1.2, -radius * 0.32);
  context.lineTo(radius * 0.25, -radius * 0.32);
  context.lineTo(radius * 0.25, -radius * 0.78);
  context.closePath();
  context.fill();
}

function drawDart(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.moveTo(radius * 1.5, 0);
  context.lineTo(radius * 0.12, radius * 0.64);
  context.lineTo(-radius * 0.2, radius * 0.3);
  context.lineTo(-radius * 1.18, radius * 0.3);
  context.lineTo(-radius * 1.18, -radius * 0.3);
  context.lineTo(-radius * 0.2, -radius * 0.3);
  context.lineTo(radius * 0.12, -radius * 0.64);
  context.closePath();
  context.fill();
}

function drawKite(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.moveTo(radius * 1.24, 0);
  context.lineTo(0, radius * 0.94);
  context.lineTo(-radius * 0.96, 0);
  context.lineTo(0, -radius * 0.94);
  context.closePath();
  context.fill();

  context.beginPath();
  context.moveTo(-radius * 0.94, 0);
  context.lineTo(-radius * 1.44, -radius * 0.2);
  context.lineTo(-radius * 1.44, radius * 0.2);
  context.closePath();
  context.fill();
}

function drawTurtle(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.ellipse(0, 0, radius * 0.95, radius * 0.72, 0, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.arc(radius * 0.92, 0, radius * 0.25, 0, Math.PI * 2);
  context.fill();

  for (const [x, y] of [
    [-radius * 0.55, -radius * 0.62],
    [radius * 0.2, -radius * 0.72],
    [-radius * 0.55, radius * 0.62],
    [radius * 0.2, radius * 0.72],
  ] as const) {
    context.beginPath();
    context.arc(x, y, radius * 0.22, 0, Math.PI * 2);
    context.fill();
  }

  context.beginPath();
  context.moveTo(-radius * 1.05, 0);
  context.lineTo(-radius * 1.48, -radius * 0.16);
  context.lineTo(-radius * 1.48, radius * 0.16);
  context.closePath();
  context.fill();
}

function drawBug(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.arc(radius * 0.55, 0, radius * 0.28, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.ellipse(0, 0, radius * 0.65, radius * 0.52, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = context.fillStyle;
  context.lineWidth = Math.max(1.5, radius * 0.16);
  context.lineCap = "round";

  for (const offset of [-0.5, 0, 0.5] as const) {
    const y = offset * radius * 0.95;
    context.beginPath();
    context.moveTo(-radius * 0.12, y);
    context.lineTo(-radius * 0.95, y - radius * 0.34);
    context.stroke();

    context.beginPath();
    context.moveTo(radius * 0.12, y);
    context.lineTo(radius * 0.95, y + radius * 0.34);
    context.stroke();
  }

  context.beginPath();
  context.moveTo(radius * 0.7, -radius * 0.18);
  context.lineTo(radius * 1.18, -radius * 0.52);
  context.stroke();

  context.beginPath();
  context.moveTo(radius * 0.7, radius * 0.18);
  context.lineTo(radius * 1.18, radius * 0.52);
  context.stroke();
}

function drawAnt(context: CanvasRenderingContext2D, radius: number) {
  const segments: Array<[number, number, number, number]> = [
    [radius * 0.78, 0, radius * 0.3, radius * 0.26],
    [radius * 0.18, 0, radius * 0.34, radius * 0.3],
    [-radius * 0.6, 0, radius * 0.46, radius * 0.4],
  ];

  for (const [x, y, rx, ry] of segments) {
    context.beginPath();
    context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = context.fillStyle;
  context.lineWidth = Math.max(1.2, radius * 0.12);
  context.lineCap = "round";

  for (const [hipX, hipY, footX, footY] of [
    [radius * 0.18, -radius * 0.22, radius * 0.55, -radius * 1.05],
    [radius * 0.08, -radius * 0.28, -radius * 0.05, -radius * 1.05],
    [-radius * 0.05, -radius * 0.28, -radius * 0.7, -radius * 1.0],
    [radius * 0.18, radius * 0.22, radius * 0.55, radius * 1.05],
    [radius * 0.08, radius * 0.28, -radius * 0.05, radius * 1.05],
    [-radius * 0.05, radius * 0.28, -radius * 0.7, radius * 1.0],
  ] as const) {
    context.beginPath();
    context.moveTo(hipX, hipY);
    context.lineTo(footX, footY);
    context.stroke();
  }

  context.beginPath();
  context.moveTo(radius * 0.95, -radius * 0.1);
  context.lineTo(radius * 1.4, -radius * 0.5);
  context.stroke();

  context.beginPath();
  context.moveTo(radius * 0.95, radius * 0.1);
  context.lineTo(radius * 1.4, radius * 0.5);
  context.stroke();
}

function drawPerson(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.arc(0, -radius * 0.7, radius * 0.32, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.moveTo(-radius * 0.45, -radius * 0.3);
  context.lineTo(radius * 0.45, -radius * 0.3);
  context.lineTo(radius * 0.32, radius * 0.35);
  context.lineTo(-radius * 0.32, radius * 0.35);
  context.closePath();
  context.fill();

  context.fillRect(-radius * 0.3, radius * 0.35, radius * 0.22, radius * 0.7);
  context.fillRect(radius * 0.08, radius * 0.35, radius * 0.22, radius * 0.7);
}

function drawWalker(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.arc(radius * 0.55, -radius * 0.6, radius * 0.28, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = context.fillStyle;
  context.lineWidth = Math.max(2, radius * 0.22);
  context.lineCap = "round";
  context.lineJoin = "round";

  context.beginPath();
  context.moveTo(radius * 0.55, -radius * 0.32);
  context.lineTo(radius * 0.2, radius * 0.3);
  context.stroke();

  context.beginPath();
  context.moveTo(radius * 0.4, -radius * 0.1);
  context.lineTo(radius * 0.85, radius * 0.05);
  context.stroke();

  context.beginPath();
  context.moveTo(radius * 0.4, -radius * 0.1);
  context.lineTo(-radius * 0.05, radius * 0.18);
  context.stroke();

  context.beginPath();
  context.moveTo(radius * 0.2, radius * 0.3);
  context.lineTo(radius * 0.65, radius * 0.95);
  context.stroke();

  context.beginPath();
  context.moveTo(radius * 0.2, radius * 0.3);
  context.lineTo(-radius * 0.35, radius * 0.95);
  context.stroke();
}

function drawCar(context: CanvasRenderingContext2D, radius: number) {
  context.fillRect(-radius * 0.95, -radius * 0.85, radius * 0.55, radius * 0.3);
  context.fillRect(radius * 0.4, -radius * 0.85, radius * 0.55, radius * 0.3);
  context.fillRect(-radius * 0.95, radius * 0.55, radius * 0.55, radius * 0.3);
  context.fillRect(radius * 0.4, radius * 0.55, radius * 0.55, radius * 0.3);

  context.beginPath();
  context.moveTo(-radius * 0.95, -radius * 0.55);
  context.lineTo(radius * 0.55, -radius * 0.55);
  context.lineTo(radius * 1.15, 0);
  context.lineTo(radius * 0.55, radius * 0.55);
  context.lineTo(-radius * 0.95, radius * 0.55);
  context.closePath();
  context.fill();
}

function drawShip(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.moveTo(radius * 1.3, 0);
  context.lineTo(radius * 0.55, -radius * 0.55);
  context.lineTo(-radius * 0.95, -radius * 0.55);
  context.lineTo(-radius * 1.05, 0);
  context.lineTo(-radius * 0.95, radius * 0.55);
  context.lineTo(radius * 0.55, radius * 0.55);
  context.closePath();
  context.fill();

  context.fillRect(-radius * 0.45, -radius * 0.32, radius * 0.7, radius * 0.64);
  context.fillRect(radius * 0.32, -radius * 0.18, radius * 0.18, radius * 0.36);
}

function drawDrone(context: CanvasRenderingContext2D, radius: number) {
  context.strokeStyle = context.fillStyle;
  context.lineWidth = Math.max(1.5, radius * 0.18);
  context.lineCap = "round";

  context.beginPath();
  context.moveTo(-radius * 0.7, -radius * 0.7);
  context.lineTo(radius * 0.7, radius * 0.7);
  context.stroke();
  context.beginPath();
  context.moveTo(-radius * 0.7, radius * 0.7);
  context.lineTo(radius * 0.7, -radius * 0.7);
  context.stroke();

  for (const [x, y] of [
    [-0.78, -0.78],
    [0.78, -0.78],
    [-0.78, 0.78],
    [0.78, 0.78],
  ] as const) {
    context.beginPath();
    context.arc(x * radius, y * radius, radius * 0.32, 0, Math.PI * 2);
    context.fill();
  }

  context.beginPath();
  context.moveTo(0, -radius * 0.32);
  context.lineTo(radius * 0.36, 0);
  context.lineTo(0, radius * 0.32);
  context.lineTo(-radius * 0.36, 0);
  context.closePath();
  context.fill();
}

function drawRobot(context: CanvasRenderingContext2D, radius: number) {
  context.fillRect(-radius * 0.18, -radius * 1.05, radius * 0.36, radius * 0.3);
  context.beginPath();
  context.arc(0, -radius * 1.1, radius * 0.16, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.moveTo(-radius * 0.78, -radius * 0.7);
  context.lineTo(radius * 0.78, -radius * 0.7);
  context.lineTo(radius * 0.92, -radius * 0.5);
  context.lineTo(radius * 0.92, radius * 0.7);
  context.lineTo(-radius * 0.92, radius * 0.7);
  context.lineTo(-radius * 0.92, -radius * 0.5);
  context.closePath();
  context.fill();

  context.save();
  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  context.arc(-radius * 0.35, -radius * 0.25, radius * 0.14, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(radius * 0.35, -radius * 0.25, radius * 0.14, 0, Math.PI * 2);
  context.fill();
  context.fillRect(-radius * 0.35, radius * 0.25, radius * 0.7, radius * 0.1);
  context.restore();
}

function drawHouse(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  context.moveTo(-radius * 1.05, -radius * 0.05);
  context.lineTo(0, -radius * 0.95);
  context.lineTo(radius * 1.05, -radius * 0.05);
  context.closePath();
  context.fill();

  context.fillRect(-radius * 0.85, -radius * 0.05, radius * 1.7, radius * 1.0);

  context.save();
  context.globalCompositeOperation = "destination-out";
  context.fillRect(-radius * 0.18, radius * 0.3, radius * 0.36, radius * 0.65);
  context.restore();
}

function drawFactory(context: CanvasRenderingContext2D, radius: number) {
  context.fillRect(-radius * 0.55, -radius * 1.05, radius * 0.28, radius * 0.7);
  context.fillRect(radius * 0.55, -radius * 0.85, radius * 0.28, radius * 0.5);

  context.fillRect(-radius * 1.1, -radius * 0.4, radius * 2.2, radius * 1.4);

  context.save();
  context.globalCompositeOperation = "destination-out";
  for (const x of [-0.7, -0.3, 0.1, 0.5, 0.85] as const) {
    context.fillRect(x * radius - radius * 0.08, radius * 0.1, radius * 0.18, radius * 0.32);
  }
  context.restore();
}

function drawVirus(context: CanvasRenderingContext2D, radius: number) {
  const spikeCount = 10;
  const innerR = radius * 0.55;
  const knobR = radius * 0.16;

  context.strokeStyle = context.fillStyle;
  context.lineWidth = Math.max(1.4, radius * 0.14);
  context.lineCap = "round";

  for (let i = 0; i < spikeCount; i++) {
    const angle = (i / spikeCount) * Math.PI * 2;
    const innerX = Math.cos(angle) * innerR;
    const innerY = Math.sin(angle) * innerR;
    const outerX = Math.cos(angle) * (radius * 0.95);
    const outerY = Math.sin(angle) * (radius * 0.95);

    context.beginPath();
    context.moveTo(innerX, innerY);
    context.lineTo(outerX, outerY);
    context.stroke();

    context.beginPath();
    context.arc(outerX, outerY, knobR, 0, Math.PI * 2);
    context.fill();
  }

  context.beginPath();
  context.arc(0, 0, innerR, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.globalCompositeOperation = "destination-out";
  for (const [x, y] of [
    [-0.18, -0.12],
    [0.2, -0.08],
    [-0.05, 0.18],
  ] as const) {
    context.beginPath();
    context.arc(x * radius, y * radius, radius * 0.08, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawSheep(context: CanvasRenderingContext2D, radius: number) {
  for (const [x, y, r] of [
    [-0.52, 0.02, 0.52],
    [-0.12, -0.28, 0.48],
    [0.22, 0.02, 0.5],
    [-0.08, 0.32, 0.46],
  ] as const) {
    context.beginPath();
    context.arc(x * radius, y * radius, r * radius, 0, Math.PI * 2);
    context.fill();
  }

  context.beginPath();
  context.arc(radius * 0.72, radius * 0.06, radius * 0.28, 0, Math.PI * 2);
  context.fill();

  context.fillRect(-radius * 0.55, radius * 0.5, radius * 0.12, radius * 0.55);
  context.fillRect(-radius * 0.12, radius * 0.55, radius * 0.12, radius * 0.5);
  context.fillRect(radius * 0.18, radius * 0.48, radius * 0.12, radius * 0.57);
}

// ---------------------------------------------------------------------------
// Multicolor sprites
//
// Each sprite paints a detailed multi-color figure into a box of roughly
// ±1.4 × radius around the origin (the same envelope the flat icons use).
// Orientable sprites are authored facing east (canvas +x, NetLogo heading
// 90°); the shared rotation logic in drawTurtleIcon orients them. All colors
// go through `paint`, which blends the style color in as a subtle accent.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

function parseHexColor(color: string): [number, number, number] | undefined {
  const value = color.trim();

  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return [
      parseInt(value[1]! + value[1]!, 16),
      parseInt(value[2]! + value[2]!, 16),
      parseInt(value[3]! + value[3]!, 16),
    ];
  }

  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [
      parseInt(value.slice(1, 3), 16),
      parseInt(value.slice(3, 5), 16),
      parseInt(value.slice(5, 7), 16),
    ];
  }

  return undefined;
}

function createSpritePaint(accentColor: string | undefined): SpritePaint {
  const accent = accentColor ? parseHexColor(accentColor) : undefined;
  if (!accent) {
    return (baseColor) => baseColor;
  }

  const cache = new Map<string, string>();

  return (baseColor) => {
    const cached = cache.get(baseColor);
    if (cached) {
      return cached;
    }

    const base = parseHexColor(baseColor);
    const mixed = base
      ? `rgb(${base
          .map((channel, index) =>
            Math.round(
              channel + (accent[index]! - channel) * SPRITE_ACCENT_STRENGTH,
            ),
          )
          .join(",")})`
      : baseColor;

    cache.set(baseColor, mixed);
    return mixed;
  };
}

function pathEllipse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rotation = 0,
) {
  context.beginPath();
  context.ellipse(x, y, rx, ry, rotation, 0, TAU);
}

function pathPolygon(
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
) {
  context.beginPath();
  context.moveTo(points[0]![0], points[0]![1]);
  for (let index = 1; index < points.length; index++) {
    context.lineTo(points[index]![0], points[index]![1]);
  }
  context.closePath();
}

function spriteStroke(context: CanvasRenderingContext2D, color: string, width: number) {
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, width);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
}

function drawSpriteAnt(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const body = paint("#a23b18");
  const dark = paint("#5c1f08");
  const light = paint("#d9743d");

  // Legs and antennae under the body.
  context.strokeStyle = paint("#46180a");
  context.lineWidth = Math.max(1, r * 0.11);
  context.lineCap = "round";
  for (const side of [-1, 1] as const) {
    for (const [hipX, hipY, footX, footY] of [
      [0.28, 0.12, 0.55, 0.62],
      [0.1, 0.14, 0.02, 0.68],
      [-0.04, 0.12, -0.45, 0.6],
    ] as const) {
      context.beginPath();
      context.moveTo(hipX * r, side * hipY * r);
      context.lineTo(footX * r, side * footY * r);
      context.stroke();
    }

    context.beginPath();
    context.moveTo(0.78 * r, side * 0.08 * r);
    context.lineTo(1.18 * r, side * 0.42 * r);
    context.stroke();
  }

  // Abdomen, waist, thorax, head.
  pathEllipse(context, -0.55 * r, 0, 0.52 * r, 0.4 * r);
  context.fillStyle = body;
  context.fill();
  spriteStroke(context, dark, r * 0.08);

  pathEllipse(context, -0.62 * r, -0.14 * r, 0.24 * r, 0.12 * r, -0.25);
  context.fillStyle = light;
  context.fill();

  pathEllipse(context, -0.1 * r, 0, 0.12 * r, 0.1 * r);
  context.fillStyle = body;
  context.fill();

  pathEllipse(context, 0.18 * r, 0, 0.3 * r, 0.24 * r);
  context.fillStyle = body;
  context.fill();
  spriteStroke(context, dark, r * 0.08);

  pathEllipse(context, 0.72 * r, 0, 0.26 * r, 0.22 * r);
  context.fillStyle = paint("#7c2a10");
  context.fill();
  spriteStroke(context, dark, r * 0.08);

  // Eyes.
  context.fillStyle = paint("#f6dfc0");
  for (const side of [-1, 1] as const) {
    pathEllipse(context, 0.82 * r, side * 0.1 * r, 0.05 * r, 0.05 * r);
    context.fill();
  }
}

function drawSpriteSheep(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const wool = paint("#f4efe3");
  const woolShade = paint("#c9c0ab");
  const face = paint("#574033");

  // Legs.
  context.fillStyle = paint("#3f2e24");
  context.fillRect(-0.34 * r, 0.5 * r, 0.17 * r, 0.55 * r);
  context.fillRect(0.17 * r, 0.5 * r, 0.17 * r, 0.55 * r);

  const woolBlobs = [
    [0, -0.05, 0.62],
    [-0.48, 0.12, 0.4],
    [0.48, 0.12, 0.4],
    [-0.32, -0.42, 0.38],
    [0.32, -0.42, 0.38],
    [0, 0.38, 0.45],
  ] as const;

  // Shaded under-layer gives the cloud an outline.
  context.fillStyle = woolShade;
  for (const [x, y, blobRadius] of woolBlobs) {
    pathEllipse(context, x * r, (y + 0.07) * r, (blobRadius + 0.05) * r, (blobRadius + 0.05) * r);
    context.fill();
  }

  context.fillStyle = wool;
  for (const [x, y, blobRadius] of woolBlobs) {
    pathEllipse(context, x * r, y * r, blobRadius * r, blobRadius * r);
    context.fill();
  }

  // Ears, face, eyes.
  context.fillStyle = face;
  pathEllipse(context, -0.38 * r, 0.04 * r, 0.2 * r, 0.1 * r, 0.5);
  context.fill();
  pathEllipse(context, 0.38 * r, 0.04 * r, 0.2 * r, 0.1 * r, -0.5);
  context.fill();

  pathEllipse(context, 0, 0.16 * r, 0.3 * r, 0.38 * r);
  context.fill();

  context.fillStyle = paint("#7a5d4b");
  pathEllipse(context, 0, 0.36 * r, 0.16 * r, 0.12 * r);
  context.fill();

  context.fillStyle = paint("#ffffff");
  for (const side of [-1, 1] as const) {
    pathEllipse(context, side * 0.12 * r, 0.08 * r, 0.055 * r, 0.055 * r);
    context.fill();
  }

  // Forelock tuft overlapping the top of the face.
  context.fillStyle = wool;
  pathEllipse(context, 0, -0.18 * r, 0.24 * r, 0.2 * r);
  context.fill();
}

function drawSpriteWolf(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const fur = paint("#6f7680");
  const dark = paint("#3f4650");
  const light = paint("#b8bec8");

  // Tail.
  pathPolygon(context, [
    [-0.8 * r, -0.05 * r],
    [-1.35 * r, -0.38 * r],
    [-1.1 * r, 0.15 * r],
  ]);
  context.fillStyle = dark;
  context.fill();

  // Legs.
  context.fillStyle = dark;
  context.fillRect(-0.75 * r, 0.22 * r, 0.16 * r, 0.58 * r);
  context.fillRect(-0.45 * r, 0.28 * r, 0.14 * r, 0.52 * r);
  context.fillRect(0.25 * r, 0.28 * r, 0.14 * r, 0.52 * r);
  context.fillRect(0.5 * r, 0.22 * r, 0.16 * r, 0.58 * r);

  // Body with lighter belly.
  pathEllipse(context, -0.08 * r, 0, 0.75 * r, 0.38 * r);
  context.fillStyle = fur;
  context.fill();
  pathEllipse(context, -0.1 * r, 0.16 * r, 0.58 * r, 0.18 * r);
  context.fillStyle = light;
  context.fill();
  pathEllipse(context, -0.08 * r, 0, 0.75 * r, 0.38 * r);
  spriteStroke(context, dark, r * 0.07);

  // Ears behind the head.
  context.fillStyle = dark;
  pathPolygon(context, [
    [0.5 * r, -0.34 * r],
    [0.56 * r, -0.78 * r],
    [0.76 * r, -0.4 * r],
  ]);
  context.fill();
  context.fillStyle = fur;
  pathPolygon(context, [
    [0.72 * r, -0.36 * r],
    [0.85 * r, -0.74 * r],
    [0.96 * r, -0.32 * r],
  ]);
  context.fill();

  // Head and snout.
  pathEllipse(context, 0.7 * r, -0.18 * r, 0.3 * r, 0.28 * r);
  context.fillStyle = fur;
  context.fill();
  pathPolygon(context, [
    [0.88 * r, -0.32 * r],
    [1.32 * r, -0.12 * r],
    [0.88 * r, 0.02 * r],
  ]);
  context.fill();
  pathEllipse(context, 1.28 * r, -0.12 * r, 0.06 * r, 0.06 * r);
  context.fillStyle = dark;
  context.fill();

  // Chest patch and eye.
  pathEllipse(context, 0.34 * r, 0.12 * r, 0.2 * r, 0.2 * r);
  context.fillStyle = light;
  context.fill();
  pathEllipse(context, 0.74 * r, -0.24 * r, 0.06 * r, 0.06 * r);
  context.fillStyle = paint("#f0a82e");
  context.fill();
}

function drawSpriteBird(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const body = paint("#3c7fc0");
  const dark = paint("#1d4e7e");
  const light = paint("#d7e8f4");

  // Tail feathers.
  pathPolygon(context, [
    [-0.65 * r, 0],
    [-1.3 * r, -0.28 * r],
    [-1.22 * r, 0.22 * r],
  ]);
  context.fillStyle = dark;
  context.fill();

  // Body and belly.
  pathEllipse(context, -0.05 * r, 0.05 * r, 0.75 * r, 0.42 * r);
  context.fillStyle = body;
  context.fill();
  pathEllipse(context, 0.05 * r, 0.22 * r, 0.5 * r, 0.22 * r);
  context.fillStyle = light;
  context.fill();
  pathEllipse(context, -0.05 * r, 0.05 * r, 0.75 * r, 0.42 * r);
  spriteStroke(context, dark, r * 0.07);

  // Head, beak, eye.
  pathEllipse(context, 0.62 * r, -0.15 * r, 0.3 * r, 0.28 * r);
  context.fillStyle = body;
  context.fill();
  pathPolygon(context, [
    [0.86 * r, -0.24 * r],
    [1.3 * r, -0.1 * r],
    [0.86 * r, 0.0 * r],
  ]);
  context.fillStyle = paint("#f2a83b");
  context.fill();
  pathEllipse(context, 0.68 * r, -0.2 * r, 0.06 * r, 0.06 * r);
  context.fillStyle = paint("#16263a");
  context.fill();

  // Raised wing.
  pathPolygon(context, [
    [-0.2 * r, -0.02 * r],
    [-0.85 * r, -0.72 * r],
    [0.05 * r, -0.5 * r],
    [0.28 * r, -0.15 * r],
  ]);
  context.fillStyle = dark;
  context.fill();
}

function drawSpriteFish(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const body = paint("#ef7d24");
  const dark = paint("#b3490f");
  const light = paint("#fcc98e");

  // Tail and fins.
  context.fillStyle = dark;
  pathPolygon(context, [
    [-0.6 * r, 0],
    [-1.25 * r, -0.45 * r],
    [-1.25 * r, 0.45 * r],
  ]);
  context.fill();
  pathPolygon(context, [
    [-0.35 * r, -0.38 * r],
    [0.05 * r, -0.85 * r],
    [0.3 * r, -0.42 * r],
  ]);
  context.fill();

  // Body and belly.
  pathEllipse(context, 0.05 * r, 0, 0.85 * r, 0.5 * r);
  context.fillStyle = body;
  context.fill();
  pathEllipse(context, 0.12 * r, 0.18 * r, 0.6 * r, 0.24 * r);
  context.fillStyle = light;
  context.fill();
  pathEllipse(context, 0.05 * r, 0, 0.85 * r, 0.5 * r);
  spriteStroke(context, dark, r * 0.07);

  // Pectoral fin and gill line.
  pathPolygon(context, [
    [0.18 * r, 0.08 * r],
    [-0.12 * r, 0.42 * r],
    [0.34 * r, 0.32 * r],
  ]);
  context.fillStyle = dark;
  context.fill();
  context.beginPath();
  context.arc(0.66 * r, 0, 0.3 * r, Math.PI * 0.65, Math.PI * 1.35);
  spriteStroke(context, dark, r * 0.06);

  // Eye.
  pathEllipse(context, 0.6 * r, -0.16 * r, 0.1 * r, 0.1 * r);
  context.fillStyle = paint("#ffffff");
  context.fill();
  pathEllipse(context, 0.63 * r, -0.16 * r, 0.05 * r, 0.05 * r);
  context.fillStyle = paint("#1d1d1f");
  context.fill();
}

function drawSpriteButterfly(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const wingTop = paint("#e8702a");
  const wingBottom = paint("#f3b32b");
  const dark = paint("#46260f");

  for (const side of [-1, 1] as const) {
    // Lower wing.
    pathEllipse(context, side * 0.42 * r, 0.45 * r, 0.36 * r, 0.3 * r, side * 0.4);
    context.fillStyle = wingBottom;
    context.fill();
    spriteStroke(context, dark, r * 0.07);

    // Upper wing.
    pathEllipse(context, side * 0.55 * r, -0.32 * r, 0.5 * r, 0.42 * r, side * 0.5);
    context.fillStyle = wingTop;
    context.fill();
    spriteStroke(context, dark, r * 0.07);

    // Wing spots.
    context.fillStyle = paint("#fdf4e3");
    pathEllipse(context, side * 0.62 * r, -0.42 * r, 0.09 * r, 0.09 * r);
    context.fill();
    pathEllipse(context, side * 0.38 * r, 0.5 * r, 0.06 * r, 0.06 * r);
    context.fill();

    // Antenna.
    context.beginPath();
    context.moveTo(side * 0.05 * r, -0.68 * r);
    context.lineTo(side * 0.3 * r, -1.05 * r);
    spriteStroke(context, dark, r * 0.06);
  }

  // Body and head on top of the wings.
  pathEllipse(context, 0, 0.05 * r, 0.12 * r, 0.55 * r);
  context.fillStyle = dark;
  context.fill();
  pathEllipse(context, 0, -0.58 * r, 0.13 * r, 0.13 * r);
  context.fill();
}

function drawSpriteBee(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const gold = paint("#f3b322");
  const black = paint("#26221c");

  // Antennae.
  context.strokeStyle = black;
  context.lineWidth = Math.max(1, r * 0.07);
  context.lineCap = "round";
  for (const side of [-1, 1] as const) {
    context.beginPath();
    context.moveTo(0.72 * r, side * 0.08 * r);
    context.lineTo(1.02 * r, side * 0.35 * r);
    context.stroke();
  }

  // Stinger.
  pathPolygon(context, [
    [-0.92 * r, -0.07 * r],
    [-1.2 * r, 0],
    [-0.92 * r, 0.07 * r],
  ]);
  context.fillStyle = black;
  context.fill();

  // Striped abdomen.
  pathEllipse(context, -0.42 * r, 0, 0.55 * r, 0.4 * r);
  context.fillStyle = gold;
  context.fill();
  context.save();
  pathEllipse(context, -0.42 * r, 0, 0.55 * r, 0.4 * r);
  context.clip();
  context.fillStyle = black;
  context.fillRect(-0.5 * r, -0.45 * r, 0.16 * r, 0.9 * r);
  context.fillRect(-0.82 * r, -0.45 * r, 0.14 * r, 0.9 * r);
  context.restore();
  pathEllipse(context, -0.42 * r, 0, 0.55 * r, 0.4 * r);
  spriteStroke(context, black, r * 0.07);

  // Thorax and head.
  pathEllipse(context, 0.2 * r, 0, 0.32 * r, 0.3 * r);
  context.fillStyle = black;
  context.fill();
  pathEllipse(context, 0.6 * r, 0, 0.22 * r, 0.2 * r);
  context.fillStyle = paint("#c98f1b");
  context.fill();
  spriteStroke(context, black, r * 0.06);

  // Translucent wings on top.
  context.save();
  context.globalAlpha *= 0.85;
  context.fillStyle = paint("#d6e6f2");
  for (const side of [-1, 1] as const) {
    pathEllipse(context, 0.02 * r, side * 0.48 * r, 0.42 * r, 0.2 * r, side * 0.45);
    context.fill();
    spriteStroke(context, paint("#9db8cc"), r * 0.05);
  }
  context.restore();
}

function drawSpriteBeetle(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const shell = paint("#cf2b1e");
  const dark = paint("#211a18");

  // Legs and antennae.
  context.strokeStyle = dark;
  context.lineWidth = Math.max(1, r * 0.1);
  context.lineCap = "round";
  for (const side of [-1, 1] as const) {
    for (const [hipX, hipY, footX, footY] of [
      [0.15, 0.3, 0.42, 0.62],
      [-0.05, 0.34, -0.15, 0.68],
      [-0.3, 0.3, -0.6, 0.56],
    ] as const) {
      context.beginPath();
      context.moveTo(hipX * r, side * hipY * r);
      context.lineTo(footX * r, side * footY * r);
      context.stroke();
    }

    context.beginPath();
    context.moveTo(0.7 * r, side * 0.06 * r);
    context.lineTo(0.98 * r, side * 0.3 * r);
    context.stroke();
  }

  // Elytra with seam and spots.
  pathEllipse(context, -0.08 * r, 0, 0.64 * r, 0.5 * r);
  context.fillStyle = shell;
  context.fill();
  spriteStroke(context, dark, r * 0.07);

  context.beginPath();
  context.moveTo(0.35 * r, 0);
  context.lineTo(-0.7 * r, 0);
  spriteStroke(context, dark, r * 0.05);

  context.fillStyle = dark;
  for (const [x, y, spotRadius] of [
    [-0.32, -0.2, 0.09],
    [-0.32, 0.2, 0.09],
    [0.08, -0.28, 0.07],
    [0.08, 0.28, 0.07],
  ] as const) {
    pathEllipse(context, x * r, y * r, spotRadius * r, spotRadius * r);
    context.fill();
  }

  // Head with eyes.
  pathEllipse(context, 0.58 * r, 0, 0.21 * r, 0.19 * r);
  context.fillStyle = dark;
  context.fill();
  context.fillStyle = paint("#f4f1ea");
  for (const side of [-1, 1] as const) {
    pathEllipse(context, 0.66 * r, side * 0.08 * r, 0.045 * r, 0.045 * r);
    context.fill();
  }
}

function drawSpriteFrog(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const green = paint("#46a14b");
  const greenDark = paint("#1f6f2e");
  const foot = paint("#36903f");

  // Hind feet.
  context.fillStyle = foot;
  pathEllipse(context, -0.62 * r, 0.45 * r, 0.3 * r, 0.16 * r, -0.2);
  context.fill();
  pathEllipse(context, 0.62 * r, 0.45 * r, 0.3 * r, 0.16 * r, 0.2);
  context.fill();

  // Body and belly.
  pathEllipse(context, 0, 0.15 * r, 0.62 * r, 0.5 * r);
  context.fillStyle = green;
  context.fill();
  pathEllipse(context, 0, 0.32 * r, 0.4 * r, 0.26 * r);
  context.fillStyle = paint("#cde8a6");
  context.fill();
  pathEllipse(context, 0, 0.15 * r, 0.62 * r, 0.5 * r);
  spriteStroke(context, greenDark, r * 0.07);

  // Head with bulging eyes.
  pathEllipse(context, 0, -0.3 * r, 0.55 * r, 0.38 * r);
  context.fillStyle = green;
  context.fill();
  spriteStroke(context, greenDark, r * 0.07);

  for (const side of [-1, 1] as const) {
    pathEllipse(context, side * 0.32 * r, -0.58 * r, 0.18 * r, 0.18 * r);
    context.fillStyle = green;
    context.fill();
    spriteStroke(context, greenDark, r * 0.06);
    pathEllipse(context, side * 0.32 * r, -0.6 * r, 0.1 * r, 0.1 * r);
    context.fillStyle = paint("#f6f3e7");
    context.fill();
    pathEllipse(context, side * 0.32 * r, -0.6 * r, 0.045 * r, 0.045 * r);
    context.fillStyle = paint("#1c1c1c");
    context.fill();
  }

  // Smile.
  context.beginPath();
  context.arc(0, -0.34 * r, 0.3 * r, Math.PI * 0.2, Math.PI * 0.8);
  spriteStroke(context, greenDark, r * 0.05);

  // Front toes.
  context.fillStyle = foot;
  pathEllipse(context, -0.25 * r, 0.62 * r, 0.16 * r, 0.09 * r);
  context.fill();
  pathEllipse(context, 0.25 * r, 0.62 * r, 0.16 * r, 0.09 * r);
  context.fill();
}

function drawSpriteMouse(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const fur = paint("#9aa1a9");
  const dark = paint("#5b6168");
  const pink = paint("#e8a3b8");

  // Tail.
  context.beginPath();
  context.moveTo(-0.7 * r, 0);
  context.quadraticCurveTo(-1.1 * r, -0.18 * r, -1.35 * r, 0.25 * r);
  spriteStroke(context, pink, r * 0.09);

  // Body and head (top view, nose east).
  pathEllipse(context, -0.22 * r, 0, 0.58 * r, 0.42 * r);
  context.fillStyle = fur;
  context.fill();
  spriteStroke(context, dark, r * 0.06);
  pathEllipse(context, 0.38 * r, 0, 0.42 * r, 0.3 * r);
  context.fillStyle = fur;
  context.fill();
  spriteStroke(context, dark, r * 0.06);

  // Ears with pink inner.
  for (const side of [-1, 1] as const) {
    pathEllipse(context, 0.18 * r, side * 0.32 * r, 0.18 * r, 0.18 * r);
    context.fillStyle = fur;
    context.fill();
    spriteStroke(context, dark, r * 0.06);
    pathEllipse(context, 0.18 * r, side * 0.32 * r, 0.1 * r, 0.1 * r);
    context.fillStyle = pink;
    context.fill();
  }

  // Nose and eyes.
  pathEllipse(context, 0.8 * r, 0, 0.08 * r, 0.07 * r);
  context.fillStyle = pink;
  context.fill();
  context.fillStyle = paint("#26282c");
  for (const side of [-1, 1] as const) {
    pathEllipse(context, 0.52 * r, side * 0.12 * r, 0.05 * r, 0.05 * r);
    context.fill();
  }
}

function drawSpriteFox(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const coat = paint("#d95f1e");
  const dark = paint("#7a2e08");
  const cream = paint("#f7e8d4");
  const black = paint("#2b1c12");

  // Bushy tail with cream tip.
  pathEllipse(context, -0.95 * r, -0.12 * r, 0.42 * r, 0.2 * r, -0.35);
  context.fillStyle = coat;
  context.fill();
  spriteStroke(context, dark, r * 0.06);
  pathEllipse(context, -1.26 * r, -0.26 * r, 0.14 * r, 0.11 * r, -0.35);
  context.fillStyle = cream;
  context.fill();

  // Legs.
  context.fillStyle = black;
  context.fillRect(-0.65 * r, 0.22 * r, 0.14 * r, 0.56 * r);
  context.fillRect(-0.38 * r, 0.28 * r, 0.13 * r, 0.5 * r);
  context.fillRect(0.22 * r, 0.28 * r, 0.13 * r, 0.5 * r);
  context.fillRect(0.46 * r, 0.22 * r, 0.14 * r, 0.56 * r);

  // Body and chest.
  pathEllipse(context, -0.05 * r, 0.02 * r, 0.68 * r, 0.36 * r);
  context.fillStyle = coat;
  context.fill();
  pathEllipse(context, 0.3 * r, 0.14 * r, 0.22 * r, 0.2 * r);
  context.fillStyle = cream;
  context.fill();
  pathEllipse(context, -0.05 * r, 0.02 * r, 0.68 * r, 0.36 * r);
  spriteStroke(context, dark, r * 0.06);

  // Ears.
  pathPolygon(context, [
    [0.44 * r, -0.34 * r],
    [0.5 * r, -0.8 * r],
    [0.7 * r, -0.4 * r],
  ]);
  context.fillStyle = dark;
  context.fill();
  pathPolygon(context, [
    [0.68 * r, -0.36 * r],
    [0.82 * r, -0.76 * r],
    [0.94 * r, -0.32 * r],
  ]);
  context.fillStyle = coat;
  context.fill();

  // Head, snout, nose, eye.
  pathEllipse(context, 0.65 * r, -0.18 * r, 0.28 * r, 0.26 * r);
  context.fillStyle = coat;
  context.fill();
  pathPolygon(context, [
    [0.84 * r, -0.3 * r],
    [1.3 * r, -0.08 * r],
    [0.84 * r, 0.02 * r],
  ]);
  context.fill();
  pathPolygon(context, [
    [0.92 * r, -0.06 * r],
    [1.18 * r, -0.05 * r],
    [0.88 * r, 0.06 * r],
  ]);
  context.fillStyle = cream;
  context.fill();
  pathEllipse(context, 1.27 * r, -0.08 * r, 0.055 * r, 0.055 * r);
  context.fillStyle = black;
  context.fill();
  pathEllipse(context, 0.7 * r, -0.22 * r, 0.05 * r, 0.05 * r);
  context.fill();
}

function drawSpriteTurtle(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const shell = paint("#2e7d4f");
  const shellDark = paint("#1b5634");
  const shellLight = paint("#7fc68f");
  const skin = paint("#a3b86c");

  // Head, feet, tail under the shell.
  context.fillStyle = skin;
  pathEllipse(context, 0.92 * r, 0, 0.24 * r, 0.22 * r);
  context.fill();
  for (const side of [-1, 1] as const) {
    pathEllipse(context, -0.55 * r, side * 0.6 * r, 0.22 * r, 0.14 * r, side * 0.5);
    context.fill();
    pathEllipse(context, 0.32 * r, side * 0.62 * r, 0.2 * r, 0.13 * r, -side * 0.5);
    context.fill();
  }
  pathPolygon(context, [
    [-0.85 * r, -0.08 * r],
    [-1.25 * r, 0],
    [-0.85 * r, 0.08 * r],
  ]);
  context.fill();

  // Eyes on the head.
  context.fillStyle = paint("#33391f");
  for (const side of [-1, 1] as const) {
    pathEllipse(context, 1.0 * r, side * 0.09 * r, 0.04 * r, 0.04 * r);
    context.fill();
  }

  // Shell with rim and center plate.
  pathEllipse(context, -0.05 * r, 0, 0.85 * r, 0.62 * r);
  context.fillStyle = shell;
  context.fill();
  spriteStroke(context, shellDark, r * 0.08);

  pathEllipse(context, -0.05 * r, 0, 0.6 * r, 0.42 * r);
  spriteStroke(context, shellLight, r * 0.06);

  pathEllipse(context, -0.05 * r, 0, 0.28 * r, 0.2 * r);
  context.fillStyle = shellLight;
  context.fill();

  // Plate seams radiating from the center.
  context.strokeStyle = shellDark;
  context.lineWidth = Math.max(1, r * 0.05);
  for (const [fromX, fromY, toX, toY] of [
    [0.22, 0, 0.55, 0],
    [-0.32, 0, -0.65, 0],
    [-0.15, -0.18, -0.32, -0.4],
    [-0.15, 0.18, -0.32, 0.4],
    [0.1, -0.16, 0.28, -0.38],
    [0.1, 0.16, 0.28, 0.38],
  ] as const) {
    context.beginPath();
    context.moveTo(fromX * r, fromY * r);
    context.lineTo(toX * r, toY * r);
    context.stroke();
  }
}

function drawSpriteCar(
  context: CanvasRenderingContext2D,
  r: number,
  paint: SpritePaint,
) {
  const body = paint("#d0312d");
  const bodyDark = paint("#7e120f");
  const glass = paint("#a9cde0");

  // Tires.
  context.fillStyle = paint("#1c1c1e");
  context.fillRect(-0.85 * r, -0.78 * r, 0.5 * r, 0.22 * r);
  context.fillRect(0.32 * r, -0.78 * r, 0.5 * r, 0.22 * r);
  context.fillRect(-0.85 * r, 0.56 * r, 0.5 * r, 0.22 * r);
  context.fillRect(0.32 * r, 0.56 * r, 0.5 * r, 0.22 * r);

  // Body (top view, nose east).
  pathPolygon(context, [
    [-1.0 * r, -0.5 * r],
    [0.6 * r, -0.5 * r],
    [1.12 * r, -0.3 * r],
    [1.12 * r, 0.3 * r],
    [0.6 * r, 0.5 * r],
    [-1.0 * r, 0.5 * r],
  ]);
  context.fillStyle = body;
  context.fill();
  spriteStroke(context, bodyDark, r * 0.06);

  // Roof.
  context.fillStyle = paint("#e25550");
  context.fillRect(-0.52 * r, -0.4 * r, 0.72 * r, 0.8 * r);

  // Windshield and rear window.
  context.fillStyle = glass;
  pathPolygon(context, [
    [0.24 * r, -0.4 * r],
    [0.56 * r, -0.3 * r],
    [0.56 * r, 0.3 * r],
    [0.24 * r, 0.4 * r],
  ]);
  context.fill();
  context.fillRect(-0.76 * r, -0.36 * r, 0.2 * r, 0.72 * r);

  // Headlights.
  context.fillStyle = paint("#f6d34d");
  pathEllipse(context, 1.04 * r, -0.24 * r, 0.07 * r, 0.07 * r);
  context.fill();
  pathEllipse(context, 1.04 * r, 0.24 * r, 0.07 * r, 0.07 * r);
  context.fill();
}
