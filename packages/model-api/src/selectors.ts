import { scaleLinear, scaleSequential } from "d3-scale";
import {
  interpolateCividis,
  interpolateCool,
  interpolateCubehelixDefault,
  interpolateInferno,
  interpolateMagma,
  interpolatePlasma,
  interpolateRainbow,
  interpolateSinebow,
  interpolateTurbo,
  interpolateViridis,
  interpolateWarm,
} from "d3-scale-chromatic";
import type {
  LinkRecord,
  PatchRecord,
  StateRegistry,
  TurtleRecord,
} from "./agents";
import type {
  PresentationColorScaleName,
  PresentationFieldStylesheet,
  PresentationResolvers,
  PresentationStyle,
  PresentationStylesheet,
} from "./presentation";

type SelectorAgent = PatchRecord | TurtleRecord | LinkRecord;
type SelectorAgentKind = "patch" | "turtle" | "link";

interface SelectorAttribute {
  name: string;
  value?: string;
}

interface CompiledSelector {
  kind?: SelectorAgentKind;
  id?: string;
  classes: string[];
  pseudos: string[];
  attributes: SelectorAttribute[];
  specificity: number;
}

interface CompiledPresentationRule {
  order: number;
  selector: CompiledSelector;
  style: PresentationStyle;
}

const selectorCache = new Map<string, CompiledSelector>();
const stylesheetRuleCache = new WeakMap<PresentationStylesheet, CompiledPresentationRule[]>();

const COLOR_INTERPOLATORS: Record<PresentationColorScaleName, (value: number) => string> = {
  viridis: interpolateViridis,
  inferno: interpolateInferno,
  magma: interpolateMagma,
  plasma: interpolatePlasma,
  cividis: interpolateCividis,
  turbo: interpolateTurbo,
  warm: interpolateWarm,
  cool: interpolateCool,
  cubehelix: interpolateCubehelixDefault,
  rainbow: interpolateRainbow,
  sinebow: interpolateSinebow,
};

export function matchesAgentSelector(
  agent: SelectorAgent,
  selector: string,
  options?: { defaultKind?: SelectorAgentKind },
) {
  return matchesCompiledSelector(agent, compileSelector(selector), options?.defaultKind);
}

export function validateSelectorSyntax(selector: string) {
  compileSelector(selector);
}

export function resolvePatchPresentationStyle({
  patch,
  states,
  stylesheet,
  resolvers,
}: {
  patch: PatchRecord;
  states: StateRegistry;
  stylesheet?: PresentationStylesheet | null;
  resolvers?: PresentationResolvers | null;
}) {
  const modelStateStyle =
    typeof patch.state === "string" ? states.patches[patch.state] : undefined;
  const stylesheetStateStyle =
    typeof patch.state === "string" ? stylesheet?.patches?.states?.[patch.state] : undefined;
  const fieldStyle = resolveFieldStyle(patch, stylesheet?.patches?.fields);
  const selectorStyle = resolveSelectorRuleStyle(patch, stylesheet, "patch");
  const resolverStyle = resolvers?.patchStyle?.(patch);

  return mergePresentationStyles(
    modelStateStyle,
    mergePresentationStyles(
      mergePresentationStyles(
        resolverStyle,
        mergePresentationStyles(
          mergePresentationStyles(stylesheet?.patches?.default, stylesheetStateStyle),
          fieldStyle,
        ),
      ),
      selectorStyle,
    ),
  );
}

export function resolveTurtlePresentationStyle({
  turtle,
  states,
  stylesheet,
  resolvers,
}: {
  turtle: TurtleRecord;
  states: StateRegistry;
  stylesheet?: PresentationStylesheet | null;
  resolvers?: PresentationResolvers | null;
}) {
  const modelStateStyle =
    typeof turtle.state === "string" ? states.breeds[turtle.breed]?.[turtle.state] : undefined;
  const stylesheetStateStyle =
    typeof turtle.state === "string"
      ? stylesheet?.breeds?.[turtle.breed]?.states?.[turtle.state]
      : undefined;
  const fieldStyle = resolveFieldStyle(turtle, stylesheet?.breeds?.[turtle.breed]?.fields);
  const selectorStyle = resolveSelectorRuleStyle(turtle, stylesheet, "turtle");
  const resolverStyle = resolvers?.turtleStyle?.(turtle);

  return mergePresentationStyles(
    modelStateStyle,
    mergePresentationStyles(
      mergePresentationStyles(
        resolverStyle,
        mergePresentationStyles(
          mergePresentationStyles(stylesheet?.breeds?.[turtle.breed]?.default, stylesheetStateStyle),
          fieldStyle,
        ),
      ),
      selectorStyle,
    ),
  );
}

export function resolveLinkPresentationStyle({
  link,
  states,
  stylesheet,
  resolvers,
}: {
  link: LinkRecord;
  states: StateRegistry;
  stylesheet?: PresentationStylesheet | null;
  resolvers?: PresentationResolvers | null;
}) {
  const modelStateStyle =
    typeof link.state === "string" ? states.links[link.breed]?.[link.state] : undefined;
  const stylesheetStateStyle =
    typeof link.state === "string"
      ? stylesheet?.links?.[link.breed]?.states?.[link.state]
      : undefined;
  const selectorStyle = resolveSelectorRuleStyle(link, stylesheet, "link");
  const resolverStyle = resolvers?.linkStyle?.(link);

  return mergePresentationStyles(
    modelStateStyle,
    mergePresentationStyles(
      mergePresentationStyles(stylesheet?.links?.[link.breed]?.default, stylesheetStateStyle),
      mergePresentationStyles(selectorStyle, resolverStyle),
    ),
  );
}

export function mergePresentationStyles(
  first: PresentationStyle | undefined,
  second: PresentationStyle | undefined,
) {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return {
    ...first,
    ...second,
  };
}

function resolveSelectorRuleStyle(
  agent: SelectorAgent,
  stylesheet: PresentationStylesheet | null | undefined,
  defaultKind: SelectorAgentKind,
) {
  if (!stylesheet?.rules || stylesheet.rules.length === 0) {
    return undefined;
  }

  let resolvedStyle: PresentationStyle | undefined;

  for (const rule of getCompiledPresentationRules(stylesheet)) {
    if (!matchesCompiledSelector(agent, rule.selector, defaultKind)) {
      continue;
    }

    resolvedStyle = mergePresentationStyles(resolvedStyle, rule.style);
  }

  return resolvedStyle;
}

// Pets field names are kebab-case but snapshot record keys are camelCase.
// Sidecars are authored in the source spelling; these convert at the
// snapshot boundary.
function kebabToCamel(name: string) {
  return name.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function camelToKebab(name: string) {
  return name.replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`);
}

function resolveFieldStyle(
  agent: PatchRecord | TurtleRecord,
  fields: Record<string, PresentationFieldStylesheet> | undefined,
) {
  if (!fields) {
    return undefined;
  }

  let resolved: PresentationStyle | undefined;

  for (const [fieldName, fieldStyle] of Object.entries(fields)) {
    const rawValue = agent[kebabToCamel(fieldName)];
    const color = fieldStyle.color
      ? resolveColorScale(Number(rawValue), fieldStyle.color)
      : undefined;

    if (color) {
      resolved = mergePresentationStyles(resolved, { color });
    }
  }

  return resolved;
}

function resolveColorScale(
  value: number,
  scaleConfig: NonNullable<PresentationFieldStylesheet["color"]>,
) {
  if (!Number.isFinite(value)) {
    return scaleConfig.unknown;
  }

  const domain = normalizeDomain(scaleConfig.domain);
  const clamp = scaleConfig.clamp !== false;

  if (scaleConfig.range && scaleConfig.range.length >= 2) {
    return scaleLinear<string>()
      .domain(normalizeRangeDomain(domain, scaleConfig.range.length))
      .range(scaleConfig.range)
      .clamp(clamp)(value);
  }

  const interpolator = COLOR_INTERPOLATORS[scaleConfig.scale ?? "viridis"];
  return scaleSequential(interpolator)
    .domain([domain[0], domain[domain.length - 1]])
    .clamp(clamp)(value);
}

function normalizeDomain(domain: number[] | undefined) {
  if (!domain || domain.length < 2) {
    return [0, 1];
  }

  const finite = domain.filter(Number.isFinite);
  return finite.length >= 2 ? finite : [0, 1];
}

function normalizeRangeDomain(domain: number[], rangeLength: number) {
  if (domain.length === rangeLength) {
    return domain;
  }

  const start = domain[0];
  const end = domain[domain.length - 1];
  const span = end - start;

  return Array.from({ length: rangeLength }, (_value, index) =>
    rangeLength === 1 ? start : start + (span * index) / (rangeLength - 1),
  );
}

function getCompiledPresentationRules(stylesheet: PresentationStylesheet) {
  const cachedRules = stylesheetRuleCache.get(stylesheet);
  if (cachedRules) {
    return cachedRules;
  }

  const compiledRules = (stylesheet.rules ?? [])
    .map((rule, order) => ({
      order,
      selector: compileSelector(rule.selector),
      style: rule.style,
    }))
    .sort((left, right) => {
      if (left.selector.specificity === right.selector.specificity) {
        return left.order - right.order;
      }

      return left.selector.specificity - right.selector.specificity;
    });

  stylesheetRuleCache.set(stylesheet, compiledRules);
  return compiledRules;
}

function compileSelector(selector: string) {
  const normalizedSelector = selector.trim();
  const cachedSelector = selectorCache.get(normalizedSelector);
  if (cachedSelector) {
    return cachedSelector;
  }

  if (normalizedSelector.length === 0) {
    throw new Error("Selector cannot be empty.");
  }

  const compiledSelector: CompiledSelector = {
    classes: [],
    pseudos: [],
    attributes: [],
    specificity: 0,
  };

  let index = 0;
  const initialToken = readIdentifier(normalizedSelector, index);
  if (initialToken) {
    if (
      initialToken.value === "patch" ||
      initialToken.value === "pet" ||
      initialToken.value === "turtle" ||
      initialToken.value === "link"
    ) {
      compiledSelector.kind = initialToken.value === "pet" ? "turtle" : initialToken.value;
      compiledSelector.specificity += 1;
      index = initialToken.nextIndex;
    } else if (initialToken.nextIndex === normalizedSelector.length) {
      compiledSelector.pseudos.push(initialToken.value);
      compiledSelector.specificity += 10;
      selectorCache.set(normalizedSelector, compiledSelector);
      return compiledSelector;
    }
  }

  while (index < normalizedSelector.length) {
    const tokenPrefix = normalizedSelector[index];

    if (tokenPrefix === ".") {
      const classToken = readRequiredIdentifier(normalizedSelector, index + 1, "class");
      compiledSelector.classes.push(classToken.value);
      compiledSelector.specificity += 10;
      index = classToken.nextIndex;
      continue;
    }

    if (tokenPrefix === ":") {
      const pseudoToken = readRequiredIdentifier(normalizedSelector, index + 1, "state");
      compiledSelector.pseudos.push(pseudoToken.value);
      compiledSelector.specificity += 10;
      index = pseudoToken.nextIndex;
      continue;
    }

    if (tokenPrefix === "#") {
      const idToken = readUntilSpecial(normalizedSelector, index + 1);
      if (idToken.value.length === 0) {
        throw new Error(`Selector "${selector}" is missing an id after "#".`);
      }
      compiledSelector.id = idToken.value;
      compiledSelector.specificity += 100;
      index = idToken.nextIndex;
      continue;
    }

    if (tokenPrefix === "[") {
      const attributeToken = readAttribute(normalizedSelector, index + 1);
      compiledSelector.attributes.push(attributeToken.attribute);
      compiledSelector.specificity += 10;
      index = attributeToken.nextIndex;
      continue;
    }

    throw new Error(`Selector "${selector}" contains unsupported token "${tokenPrefix}".`);
  }

  if (
    !compiledSelector.kind &&
    !compiledSelector.id &&
    compiledSelector.classes.length === 0 &&
    compiledSelector.pseudos.length === 0 &&
    compiledSelector.attributes.length === 0
  ) {
    throw new Error(`Selector "${selector}" does not contain any supported terms.`);
  }

  selectorCache.set(normalizedSelector, compiledSelector);
  return compiledSelector;
}

function matchesCompiledSelector(
  agent: SelectorAgent,
  selector: CompiledSelector,
  defaultKind?: SelectorAgentKind,
) {
  const agentKind = getAgentKind(agent);
  const selectorKind = selector.kind ?? defaultKind;
  if (selectorKind && agentKind !== selectorKind) {
    return false;
  }

  if (selector.id && getAgentId(agent) !== selector.id) {
    return false;
  }

  const classNames = getAgentClasses(agent);
  for (const className of selector.classes) {
    if (!classNames.has(className)) {
      return false;
    }
  }

  for (const pseudo of selector.pseudos) {
    if (!matchesPseudo(agent, pseudo)) {
      return false;
    }
  }

  for (const attribute of selector.attributes) {
    if (!matchesAttribute(agent, attribute)) {
      return false;
    }
  }

  return true;
}

function getAgentKind(agent: SelectorAgent): SelectorAgentKind {
  if ("end1Id" in agent && "end2Id" in agent) {
    return "link";
  }

  return "breed" in agent ? "turtle" : "patch";
}

function getAgentId(agent: SelectorAgent) {
  if ("end1Id" in agent && "end2Id" in agent) {
    return String(agent.id);
  }

  if ("breed" in agent) {
    return String(agent.id);
  }

  return `${agent.px},${agent.py}`;
}

function getAgentClasses(agent: SelectorAgent) {
  const classes = new Set<string>();

  if ("breed" in agent && typeof agent.breed === "string") {
    classes.add(agent.breed);
  }

  const candidates = [
    (agent as { class?: unknown }).class,
    (agent as { className?: unknown }).className,
    (agent as { classes?: unknown }).classes,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      for (const className of candidate.split(/\s+/)) {
        if (className.length > 0) {
          classes.add(className);
        }
      }
      continue;
    }

    if (Array.isArray(candidate)) {
      for (const className of candidate) {
        if (typeof className === "string" && className.length > 0) {
          classes.add(className);
        }
      }
    }
  }

  return classes;
}

function matchesPseudo(agent: SelectorAgent, pseudo: string) {
  const state = (agent as { state?: unknown }).state;
  const status = (agent as { status?: unknown }).status;

  return state === pseudo || status === pseudo;
}

function matchesAttribute(agent: SelectorAgent, attribute: SelectorAttribute) {
  if (!Object.prototype.hasOwnProperty.call(agent, attribute.name)) {
    return false;
  }

  const value = (agent as Record<string, unknown>)[attribute.name];
  if (typeof value === "function") {
    return false;
  }

  if (attribute.value === undefined) {
    return true;
  }

  return String(value) === attribute.value;
}

function readIdentifier(source: string, startIndex: number) {
  if (startIndex >= source.length || !/[_a-zA-Z]/.test(source[startIndex])) {
    return null;
  }

  let index = startIndex + 1;
  while (index < source.length && /[_a-zA-Z0-9-]/.test(source[index])) {
    index += 1;
  }

  return {
    value: source.slice(startIndex, index),
    nextIndex: index,
  };
}

function readRequiredIdentifier(source: string, startIndex: number, label: string) {
  const token = readIdentifier(source, startIndex);
  if (!token) {
    throw new Error(`Selector "${source}" is missing a ${label} name.`);
  }
  return token;
}

function readUntilSpecial(source: string, startIndex: number) {
  let index = startIndex;
  while (index < source.length && !/[.:[#]/.test(source[index])) {
    index += 1;
  }

  return {
    value: source.slice(startIndex, index),
    nextIndex: index,
  };
}

function readAttribute(source: string, startIndex: number) {
  const nameToken = readRequiredIdentifier(source, startIndex, "attribute");
  if (/[A-Z]/.test(nameToken.value)) {
    throw new Error(
      `Selector "${source}" attribute "${nameToken.value}": sidecar names use the source spelling — write "${camelToKebab(nameToken.value)}".`,
    );
  }
  let index = nameToken.nextIndex;

  if (source[index] === "]") {
    return {
      attribute: { name: kebabToCamel(nameToken.value) } satisfies SelectorAttribute,
      nextIndex: index + 1,
    };
  }

  if (source[index] !== "=") {
    throw new Error(`Selector "${source}" contains an invalid attribute selector.`);
  }

  index += 1;

  let value = "";
  if (source[index] === '"' || source[index] === "'") {
    const quote = source[index];
    index += 1;
    const valueStart = index;
    while (index < source.length && source[index] !== quote) {
      index += 1;
    }

    if (index >= source.length) {
      throw new Error(`Selector "${source}" has an unterminated quoted attribute value.`);
    }

    value = source.slice(valueStart, index);
    index += 1;
  } else {
    const valueStart = index;
    while (index < source.length && source[index] !== "]") {
      index += 1;
    }
    value = source.slice(valueStart, index).trim();
  }

  if (source[index] !== "]") {
    throw new Error(`Selector "${source}" has an unterminated attribute selector.`);
  }

  return {
    attribute: {
      name: kebabToCamel(nameToken.value),
      value,
    } satisfies SelectorAttribute,
    nextIndex: index + 1,
  };
}
