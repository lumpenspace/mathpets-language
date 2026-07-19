import {
  parseAgentSetExpression,
  parseAgentSetReporterExpression,
  type PetsAgentSetExpression,
  type PetsAgentSetReporterExpression,
} from "./agentset-expression";
import type {
  PetsActionDef,
  PetsDefParam,
  PetsAgentAction,
  PetsAssignment,
  PetsCommandStatement,
  PetsPetBreed,
  PetsPetField,
  PetsDef,
  PetsDefStatement,
  PetsExpression,
  PetsLinkBreed,
  PetsLinkField,
  PetsMemoryField,
  PetsModel,
  PetsMonitor,
  PetsParam,
  PetsPatchField,
  PetsStatement,
  PetsRoundSection,
  PetsType,
  PetsWorld,
  PetsZoneBreed,
  PetsZoneField,
} from "./ast";

interface EmitContext {
  model: PetsModel;
  defs: Set<string>;
  params: Map<string, PetsType>;
  patchFields: Set<string>;
  patchBooleanFields: Set<string>;
  zoneFields: Set<string>;
  zoneBooleanFields: Set<string>;
  zoneNames: Set<string>;
  petFields: Set<string>;
  petBooleanFields: Set<string>;
  breedNames: Set<string>;
  linkFields: Set<string>;
  linkBooleanFields: Set<string>;
  linkBreedNames: Set<string>;
  enumValues: Set<string>;
  stateValues: Set<string>;
  memoryFields: Map<string, PetsType>;
  petActions: Map<string, PetsActionDef>;
  breedActions: Map<string, Map<string, PetsActionDef>>;
  randomSaltCounter: { next: number };
  protectionCounter: { next: number };
}

interface ExpressionContext extends EmitContext {
  agent?: string;
  agentSet?: string;
  askerAgentSet?: string;
  locals?: Set<string>;
  localTypes?: Map<string, PetsType>;
  queryLocals?: Set<string>;
  selfAgent?: string;
  statePredicate?: boolean;
  actionStack?: string[];
}

const PATCH_NEIGHBOR_DIRECTIONS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

const PATCH_NEIGHBOR_DIRECTION_SET = new Set<string>(PATCH_NEIGHBOR_DIRECTIONS);

export function emitJavaScript(model: PetsModel) {
  const context = createEmitContext(model);
  const modelFields = [
    ...model.params.map((param) => emitParam(param)),
    ...model.monitors.map((monitor) => emitMonitor(monitor, context)),
  ];
  const rounds = model.rounds ?? [];
  const decideMap = collectDecideMap(rounds);
  const barrierRounds = rounds.filter((round) => round.mode !== "async");
  const asyncRounds = rounds.filter((round) => round.mode === "async");
  const autonomicBodies = model.steps.map((step) =>
    emitStepStatements(step.statements, context, step.staged),
  );
  const barrierBodies = barrierRounds.map((round) =>
    emitStepStatements(stripDecideStatements(round.statements), context, round.mode === "staged"),
  );
  // A mixed model (rounds + steps) splits the two phases across two slots:
  // `world.step` carries the autonomic `step` sections, `world.barrierStep`
  // carries the `round` barrier. A pure round model keeps its barrier in
  // `world.step` (no separate slot), exactly as before.
  const isMixed = rounds.length > 0 && model.steps.length > 0;
  const stepBodies = rounds.length > 0 && !isMixed ? barrierBodies : autonomicBodies;

  return `import { defineModel } from "@pets/model-api";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createModel() {
  return defineModel((m) => {
    const nobody = undefined;
    const world = m.world({
      minX: ${model.world.minX},
      maxX: ${model.world.maxX},
      minY: ${model.world.minY},
      maxY: ${model.world.maxY},
      topology: ${JSON.stringify(model.world.topology)},
    });

${emitPatchRegionHelpers()}

${model.zones.length > 0 ? emitZoneRuntime(model.zones) : ""}

${model.pets.map((breed) => emitPetBreed(breed, decideMap.get(breed.name) ?? [])).join("\n\n")}

${model.links.map((breed) => emitLinkBreed(breed)).join("\n\n")}

${model.pets.length > 0 ? emitPetAtHelper() : ""}

${model.memory.map((field) => emitMemoryField(field, context)).join("\n")}

${model.defs.map((def) => emitDef(def, context)).join("\n\n")}

    m.params({
${modelFields.join(",\n")}
    });

    m.patchesOwn(
      {
${model.patches.map((field) => emitPatchField(field)).join(",\n")}
      },
      {
        states: ${JSON.stringify(model.patches.find((field) => field.name === "state")?.states ?? [])},
      },
    );

${rounds.length > 0 ? emitRoundConfig(rounds, decideMap) : ""}
    world.setup = () => {
${model.zones.length > 0 ? "      rebuildZones();" : ""}
${model.setup.map((statement) => emitStatement(statement, context, false)).join("\n")}
    };

    world.step = () => {
${stepBodies.join("\n")}
    };
${isMixed ? `
    world.barrierStep = () => {
${barrierBodies.join("\n")}
    };
` : ""}${asyncRounds.length > 0 ? emitAsyncStep(asyncRounds, context) : ""}
${model.brush ? emitBrushSection(model.brush, context) : ""}
${model.stop ? `
    world.endCondition = () => ${emitPredicateExpression(model.stop, context)};
` : ""}
  });
}
`;
}

function emitPatchRegionHelpers() {
  return `    function checkLookup(agent, contextDescription, suggestion, type = "pet") {
      if (agent === undefined || agent === null) {
        throw new Error(\`\${contextDescription} found no \${type}; \${suggestion}\`);
      }
      return agent;
    }

    const patchRegionShortestDelta = (start, end, span) => {
      let delta = end - start;
      if (delta > span / 2) {
        delta -= span;
      } else if (delta < -span / 2) {
        delta += span;
      }
      return delta;
    };

    const patchRegionDelta = (start, end, axis) => {
      const wrap = axis === "x"
        ? world.config.topology === "torus" || world.config.topology === "wrap-x"
        : world.config.topology === "torus" || world.config.topology === "wrap-y";
      const span = axis === "x"
        ? world.config.maxX - world.config.minX + 1
        : world.config.maxY - world.config.minY + 1;
      return wrap ? patchRegionShortestDelta(start, end, span) : end - start;
    };

    function patchInRadius(patch, radius, centerX, centerY) {
      const dx = patchRegionDelta(Number(centerX), patch.px, "x");
      const dy = patchRegionDelta(Number(centerY), patch.py, "y");
      return Math.hypot(dx, dy) <= Number(radius);
    }

    function patchInSquare(patch, radius, centerX, centerY) {
      const dx = Math.abs(patchRegionDelta(Number(centerX), patch.px, "x"));
      const dy = Math.abs(patchRegionDelta(Number(centerY), patch.py, "y"));
      return dx <= Number(radius) && dy <= Number(radius);
    }

    function arrayQuery(items) {
      return {
        filter(predicate) {
          return arrayQuery(items.filter(predicate));
        },
        ask(effect) {
          for (const item of world.random.shuffle([...items])) {
            effect(item);
          }
        },
        askBatch(effect) {
          const staged = world.random.shuffle([...items]).map((item) => {
            const draft = { ...item };
            effect(item, draft);
            return { item, draft };
          });

          for (const { item, draft } of staged) {
            for (const [key, value] of Object.entries(draft)) {
              if (typeof value !== "function") {
                item[key] = value;
              }
            }
          }
        },
        map(callback) {
          return items.map(callback);
        },
        count() {
          return items.length;
        },
        oneOf() {
          return items.length === 0 ? undefined : items[world.random.int(items.length)];
        },
        nOf(count) {
          return world.random.shuffle([...items]).slice(0, Number(count));
        },
        other(origin) {
          return arrayQuery(items.filter((candidate) => candidate !== origin && candidate?.id !== origin?.id));
        },
        toArray() {
          return [...items];
        },
        [Symbol.iterator]() {
          return items[Symbol.iterator]();
        },
      };
    }

    function candidatesToArray(candidates) {
      if (Array.isArray(candidates)) {
        return candidates;
      }
      return candidates?.toArray ? candidates.toArray() : [];
    }

    function rankedOneOf(origin, candidates, scoreCandidate, mode = "max", randomSalt = "ranked-one-of") {
      const items = candidatesToArray(candidates);
      const winners = [];
      let bestScore = mode === "min" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;

      for (const candidate of items) {
        const score = scoreCandidate(candidate);
        if (!Number.isFinite(score)) {
          continue;
        }

        const better = mode === "min" ? score < bestScore : score > bestScore;
        if (better) {
          winners.length = 0;
          winners.push(candidate);
          bestScore = score;
          continue;
        }

        if (score === bestScore) {
          winners.push(candidate);
        }
      }

      return winners.length === 0
        ? undefined
        : winners[m.randomIntFor(origin, randomSalt, winners.length)];
    }

    function spatialPatchPoint(item) {
      const patch = item?.patchHere?.();
      if (patch) {
        return { x: Number(patch.px), y: Number(patch.py) };
      }

      if (item && "px" in item && "py" in item) {
        return { x: Number(item.px), y: Number(item.py) };
      }

      if (item && "x" in item && "y" in item) {
        return { x: Math.round(Number(item.x)), y: Math.round(Number(item.y)) };
      }

      return undefined;
    }

    function aroundPatchQuery(centerX, centerY) {
      return arrayQuery(
        [
          m.patchAt(Number(centerX) - 1, Number(centerY) - 1),
          m.patchAt(Number(centerX), Number(centerY) - 1),
          m.patchAt(Number(centerX) + 1, Number(centerY) - 1),
          m.patchAt(Number(centerX) - 1, Number(centerY)),
          m.patchAt(Number(centerX) + 1, Number(centerY)),
          m.patchAt(Number(centerX) - 1, Number(centerY) + 1),
          m.patchAt(Number(centerX), Number(centerY) + 1),
          m.patchAt(Number(centerX) + 1, Number(centerY) + 1),
        ].filter(Boolean),
      );
    }

    function aroundQuery(query, centerX, centerY) {
      return query.filter((candidate) => {
        const point = spatialPatchPoint(candidate);
        if (!point) {
          return false;
        }

        const dx = Math.abs(patchRegionDelta(Number(centerX), point.x, "x"));
        const dy = Math.abs(patchRegionDelta(Number(centerY), point.y, "y"));
        return dx <= 1 && dy <= 1 && (dx !== 0 || dy !== 0);
      });
    }`;
}

function emitZoneRuntime(zones: PetsZoneBreed[]) {
  return `${zones.map((zone) => `    let ${toJsIdentifier(zone.name)} = [];`).join("\n")}

    function createZones(name, side, schema) {
      const size = Math.max(1, Math.floor(Number(side)));
      const zones = [];
      const byPatchKey = new Map();
      const minX = Math.ceil(world.config.minX);
      const maxX = Math.floor(world.config.maxX);
      const minY = Math.ceil(world.config.minY);
      const maxY = Math.floor(world.config.maxY);

      for (let originX = minX, zx = 0; originX <= maxX; originX += size, zx += 1) {
        for (let originY = minY, zy = 0; originY <= maxY; originY += size, zy += 1) {
          const patches = [];
          const endX = Math.min(originX + size - 1, maxX);
          const endY = Math.min(originY + size - 1, maxY);

          for (let px = originX; px <= endX; px += 1) {
            for (let py = originY; py <= endY; py += 1) {
              const patch = m.patchAt(px, py);
              if (patch) {
                patches.push(patch);
                byPatchKey.set(\`\${patch.px},\${patch.py}\`, zones.length);
              }
            }
          }

          const zone = {
            zone: name,
            zx,
            zy,
            px: originX,
            py: originY,
            x: (originX + endX) / 2,
            y: (originY + endY) / 2,
            size,
            patchesIn() {
              return arrayQuery(patches);
            },
          };

          Object.assign(zone, schema);
          zones.push(zone);
        }
      }

      Object.defineProperty(zones, "byPatchKey", { value: byPatchKey });
      return zones;
    }

    function zoneAt(zones, x, y) {
      const patch = m.patchAt(Number(x), Number(y));
      if (!patch) {
        return undefined;
      }

      const index = zones.byPatchKey?.get(\`\${patch.px},\${patch.py}\`);
      return index === undefined ? undefined : zones[index];
    }

    function zoneOf(zones, item) {
      const point = spatialPatchPoint(item);
      return point ? zoneAt(zones, point.x, point.y) : undefined;
    }

    function rebuildZones() {
${zones.map((zone) => `      ${toJsIdentifier(zone.name)} = createZones(${JSON.stringify(zone.name)}, ${zone.size}, {
${zone.fields.map((field) => emitZoneField(field)).join(",\n")}
      });`).join("\n")}
    }`;
}

function createEmitContext(model: PetsModel): EmitContext {
  const stateField = model.patches.find((field) => field.name === "state");

  return {
    model,
    defs: new Set(model.defs.map((def) => def.name)),
    params: new Map([
      ...model.params.map((param) => [param.name, param.type] as const),
      ...model.monitors.map((monitor) => [monitor.name, monitor.type] as const),
    ]),
    // `wall` is a built-in boolean patch field (like px/py, but writable). It
    // resolves in patch contexts without being declared in `patches:`.
    patchFields: new Set(["wall", ...model.patches.map((field) => field.name)]),
    patchBooleanFields: new Set([
      "wall",
      ...model.patches.filter((field) => field.type.kind === "boolean").map((field) => field.name),
    ]),
    zoneFields: new Set([
      "zone",
      "zx",
      "zy",
      "px",
      "py",
      "x",
      "y",
      "size",
      ...model.zones.flatMap((zone) => zone.fields.map((field) => field.name)),
    ]),
    zoneBooleanFields: new Set(
      model.zones.flatMap((zone) =>
        zone.fields.filter((field) => field.type.kind === "boolean").map((field) => field.name),
      ),
    ),
    zoneNames: new Set(model.zones.map((zone) => zone.name)),
    petFields: new Set([
      "id",
      "x",
      "y",
      "heading",
      "color",
      "size",
      "orientable",
      "shape",
      "hidden",
      "label",
      "breed",
      // Implicit boolean field on deciding breeds of turn-based models.
      ...((model.rounds?.length ?? 0) > 0 ? ["decided"] : []),
      ...model.pets.flatMap((breed) => breed.fields.map((field) => field.name)),
    ]),
    petBooleanFields: new Set([
      "hidden",
      ...((model.rounds?.length ?? 0) > 0 ? ["decided"] : []),
      ...model.pets.flatMap((breed) =>
        breed.fields.filter((field) => field.type.kind === "boolean").map((field) => field.name),
      ),
    ]),
    breedNames: new Set(model.pets.map((breed) => breed.name)),
    linkFields: new Set([
      "id",
      "breed",
      "directed",
      "end1-id",
      "end2-id",
      "color",
      "thickness",
      "hidden",
      "label",
      ...model.links.flatMap((breed) => breed.fields.map((field) => field.name)),
    ]),
    linkBooleanFields: new Set([
      "hidden",
      ...model.links.flatMap((breed) =>
        breed.fields.filter((field) => field.type.kind === "boolean").map((field) => field.name),
      ),
    ]),
    linkBreedNames: new Set(model.links.map((breed) => breed.name)),
    enumValues: new Set(
      [
        ...model.patches,
        ...model.zones.flatMap((zone) => zone.fields),
        ...model.pets.flatMap((breed) => breed.fields),
        ...model.links.flatMap((breed) => breed.fields),
        ...model.params,
        ...model.memory,
      ].flatMap((field) => field.type.kind === "enum" ? field.type.values : []),
    ),
    stateValues: new Set([
      ...(stateField?.type.kind === "enum" ? stateField.type.values : []),
      ...model.zones.flatMap((zone) => {
        const zoneState = zone.fields.find((field) => field.name === "state");
        return zoneState?.type.kind === "enum" ? zoneState.type.values : [];
      }),
      ...model.pets.flatMap((breed) => {
        const petState = breed.fields.find((field) => field.name === "state");
        return petState?.type.kind === "enum" ? petState.type.values : [];
      }),
      ...model.links.flatMap((breed) => {
        const linkState = breed.fields.find((field) => field.name === "state");
        return linkState?.type.kind === "enum" ? linkState.type.values : [];
      }),
    ]),
    memoryFields: new Map(model.memory.map((field) => [field.name, field.type] as const)),
    petActions: new Map(model.petActions.map((action) => [action.name, action] as const)),
    breedActions: new Map(
      model.pets.map((breed) => [
        breed.name,
        new Map(breed.actions.map((action) => [action.name, action] as const)),
      ] as const),
    ),
    randomSaltCounter: { next: 0 },
    protectionCounter: { next: 0 },
  };
}

function emitPetBreed(breed: PetsPetBreed, decideFields: string[] = []) {
  const stateField = breed.fields.find((field) => field.name === "state");
  const ownFields = breed.fields.map((field) =>
    emitPetField(field, decideFields.includes(field.name)),
  );

  if (decideFields.length > 0) {
    // Implicit engine-managed field on deciding breeds of turn-based models,
    // emitted exactly as if the user had declared `decided: boolean = false`.
    ownFields.push("      decided: false");
  }

  return `    const ${toJsIdentifier(breed.name)} = m.petBreed(${JSON.stringify(breed.name)}, {
      states: ${JSON.stringify(stateField?.states ?? [])},${breed.isPlayer ? "\n      player: true," : ""}
    });
    ${toJsIdentifier(breed.name)}.own({
${ownFields.join(",\n")}
    });`;
}

function emitPetField(field: PetsPetField, decided = false) {
  if (field.type.kind === "ref") {
    return `      ${toJsIdentifier(field.name)}: m.refField(${JSON.stringify(field.type.to)})`;
  }
  // Externally-decided enum fields carry their membership as metadata so the
  // turn runtime can validate submissions strictly.
  if (decided && field.type.kind === "enum" && Array.isArray(field.type.values)) {
    return `      ${toJsIdentifier(field.name)}: m.editable.enum(${literal(field.initialValue)}, { options: ${JSON.stringify(field.type.values)} })`;
  }
  return `      ${toJsIdentifier(field.name)}: ${literal(field.initialValue)}`;
}

function emitLinkBreed(breed: PetsLinkBreed) {
  const stateField = breed.fields.find((field) => field.name === "state");

  return `    const ${toJsIdentifier(breed.name)} = m.linkBreed(${JSON.stringify(breed.name)}, {
      directed: ${breed.directed ? "true" : "false"},${breed.decay === undefined ? "" : `\n      decay: ${breed.decay},`}
      states: ${JSON.stringify(stateField?.states ?? [])},
    });
    ${toJsIdentifier(breed.name)}.own({
${breed.fields.map((field) => emitLinkField(field)).join(",\n")}
    });`;
}

function emitLinkField(field: PetsLinkField) {
  if (field.type.kind === "ref") {
    return `      ${toJsIdentifier(field.name)}: m.refField(${JSON.stringify(field.type.to)})`;
  }
  return `      ${toJsIdentifier(field.name)}: ${literal(field.initialValue)}`;
}

function emitPetAtHelper() {
  return `    let petAtCacheRevision = -1;
    const petAtCache = new Map();

    const normalizeHeading = (heading) => {
      const wrapped = heading % 360;
      return wrapped < 0 ? wrapped + 360 : wrapped;
    };

    const shortestDelta = (start, end, span) => {
      let delta = end - start;
      if (delta > span / 2) {
        delta -= span;
      } else if (delta < -span / 2) {
        delta += span;
      }
      return delta;
    };

    const topologyWrapsAxis = (axis) =>
      axis === "x"
        ? world.config.topology === "torus" || world.config.topology === "wrap-x"
        : world.config.topology === "torus" || world.config.topology === "wrap-y";

    const normalizeWorldCoordinate = (value, axis) => {
      const numeric = Number(value);
      const min = axis === "x" ? world.config.minX : world.config.minY;
      const max = axis === "x" ? world.config.maxX : world.config.maxY;

      if (!topologyWrapsAxis(axis)) {
        return clamp(numeric, min, max);
      }

      const span = max - min + 1;
      return ((((numeric - min) % span) + span) % span) + min;
    };

    const normalizeWorldPoint = (x, y) => ({
      x: normalizeWorldCoordinate(x, "x"),
      y: normalizeWorldCoordinate(y, "y"),
    });

    const objectCoordinates = (item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      if ("px" in item && "py" in item) {
        return { x: Number(item.px), y: Number(item.py) };
      }

      return { x: Number(item.x), y: Number(item.y) };
    };

    const deltaToObject = (origin, target) => {
      const targetPoint = objectCoordinates(target);
      if (!targetPoint) {
        return undefined;
      }

      const spanX = world.config.maxX - world.config.minX + 1;
      const spanY = world.config.maxY - world.config.minY + 1;

      return {
        x: topologyWrapsAxis("x") ? shortestDelta(origin.x, targetPoint.x, spanX) : targetPoint.x - origin.x,
        y: topologyWrapsAxis("y") ? shortestDelta(origin.y, targetPoint.y, spanY) : targetPoint.y - origin.y,
      };
    };

    const distanceToObject = (origin, target) => {
      const delta = deltaToObject(origin, target);
      return delta ? Math.hypot(delta.x, delta.y) : Number.POSITIVE_INFINITY;
    };

    function nearestTo(origin, candidates) {
      let nearest;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        const distance = distanceToObject(origin, candidate);
        if (distance < bestDistance) {
          nearest = candidate;
          bestDistance = distance;
        }
      }

      return nearest;
    }

    function faceTowards(agent, target, percent = 100) {
      const delta = deltaToObject(agent, target);
      if (!delta || (delta.x === 0 && delta.y === 0)) {
        return;
      }

      const targetHeading = normalizeHeading((Math.atan2(delta.x, delta.y) * 180) / Math.PI);
      let turn = ((targetHeading - agent.heading + 540) % 360) - 180;
      if (turn === -180) {
        turn = 180;
      }
      const amount = Math.max(0, Math.min(100, Number(percent))) / 100;
      agent.heading = normalizeHeading(agent.heading + turn * amount);
    }

    const subtractHeadings = (targetHeading, currentHeading) => {
      let turn = ((targetHeading - currentHeading + 540) % 360) - 180;
      return turn === -180 ? 180 : turn;
    };

    const turnAtMost = (turn, maxTurn) => {
      const limit = Math.abs(Number(maxTurn));
      if (Math.abs(turn) <= limit) {
        return turn;
      }
      return turn > 0 ? limit : -limit;
    };

    const headingToObject = (origin, target) => {
      const delta = deltaToObject(origin, target);
      if (!delta || (delta.x === 0 && delta.y === 0)) {
        return origin.heading;
      }
      return normalizeHeading((Math.atan2(delta.x, delta.y) * 180) / Math.PI);
    };

    const headingVector = (heading) => {
      const radians = (Number(heading) * Math.PI) / 180;
      return {
        x: Math.sin(radians),
        y: Math.cos(radians),
      };
    };

    const vectorHeading = (x, y, fallback = 0) => {
      if (x === 0 && y === 0) {
        return fallback;
      }
      return normalizeHeading((Math.atan2(x, y) * 180) / Math.PI);
    };

    function turnTowardsValue(agent, target, maxTurn) {
      const targetHeading = typeof target === "number"
        ? normalizeHeading(target)
        : headingToObject(agent, target);
      agent.heading = normalizeHeading(
        agent.heading + turnAtMost(subtractHeadings(targetHeading, agent.heading), maxTurn),
      );
    }

    function turnAwayFromValue(agent, target, maxTurn) {
      const targetHeading = typeof target === "number"
        ? normalizeHeading(target)
        : headingToObject(agent, target);
      agent.heading = normalizeHeading(
        agent.heading + turnAtMost(subtractHeadings(agent.heading, targetHeading), maxTurn),
      );
    }

    function setPosition(agent, x, y) {
      const point = normalizeWorldPoint(x, y);
      agent.x = point.x;
      agent.y = point.y;
    }

    function moveTo(agent, target) {
      const targetPoint = objectCoordinates(target);
      if (!targetPoint) {
        return;
      }
      const point = normalizeWorldPoint(targetPoint.x, targetPoint.y);
      agent.x = point.x;
      agent.y = point.y;
    }

    function setRandomPosition(agent, xSalt, ySalt) {
      agent.x = world.config.minX + m.randomFloatFor(agent, xSalt, world.config.maxX - world.config.minX);
      agent.y = world.config.minY + m.randomFloatFor(agent, ySalt, world.config.maxY - world.config.minY);
    }

    function scatterFrom(agent, anchor, spread, xSalt, ySalt) {
      const point = objectCoordinates(anchor);
      if (!point) {
        return;
      }
      const size = Math.max(0, Number(spread));
      setPosition(
        agent,
        point.x + m.randomFloatFor(agent, xSalt, size) - size / 2,
        point.y + m.randomFloatFor(agent, ySalt, size) - size / 2,
      );
    }

    function wiggle(agent, salt) {
      agent.turn(m.randomIntFor(agent, String(salt) + ":right", 40));
      agent.turn(-m.randomIntFor(agent, String(salt) + ":left", 40));
    }

    function patchFieldValue(patch, field) {
      return Number(patch?.[field] ?? 0);
    }

    function gradientCandidateValue(patch, field) {
      if (!patch || patch.wall === true) {
        return Number.NEGATIVE_INFINITY;
      }
      return Number(patch[field] ?? 0);
    }

    function followPatchGradient(agent, field, minValue, maxValue, turnAngle = 45, distance = 1, randomSalt = "follow-patch-gradient") {
      const currentValue = patchFieldValue(agent.patchHere(), field);
      const canFollow =
        (minValue === undefined || currentValue >= Number(minValue)) &&
        (maxValue === undefined || currentValue < Number(maxValue));

      if (canFollow) {
        const ahead = gradientCandidateValue(agent.patchRightAndAhead(0, distance), field);
        const right = gradientCandidateValue(agent.patchRightAndAhead(turnAngle, distance), field);
        const left = gradientCandidateValue(agent.patchLeftAndAhead(turnAngle, distance), field);

        if (right > ahead || left > ahead) {
          agent.turn(right > left ? turnAngle : -turnAngle);
        }
      }

      wiggle(agent, randomSalt);
    }

    function samePatch(left, right) {
      const leftPatch = left?.patchHere?.();
      const rightPatch = right?.patchHere?.();
      return Boolean(leftPatch && rightPatch && leftPatch === rightPatch);
    }

    function copyPetFields(parent, child) {
      for (const [key, value] of Object.entries(parent)) {
        if (
          key === "id" ||
          key === "breed" ||
          key === "patchHere" ||
          key === "patchAhead" ||
          key === "patchLeftAndAhead" ||
          key === "patchRightAndAhead" ||
          key === "canMove" ||
          key === "setRandomPosition" ||
          key === "turn" ||
          key === "forward"
        ) {
          continue;
        }
        child[key] = value;
      }
    }

    function hatchFrom(parent, breed, randomSalt = "hatch") {
      const targetBreed = breed ?? { name: parent.breed };
      return m.createPet(targetBreed, (child) => {
        copyPetFields(parent, child);
        child.turn(m.randomFloatFor(child, randomSalt, 360));
        child.forward(1);
      });
    }

    function killOneAt(agent, breed, energyField, energyGain = 0, randomSalt = "kill-one") {
      const candidates = breed.all().filter((candidate) => samePatch(candidate, agent)).toArray();
      const prey = candidates.length === 0
        ? undefined
        : candidates[m.randomIntFor(agent, randomSalt, candidates.length)];
      if (prey) {
        m.removePet(prey);
        if (energyField) {
          agent[energyField] = Number(agent[energyField] ?? 0) + Number(energyGain);
        }
      }
      return prey;
    }

    function inRadiusQuery(origin, breed, radius) {
      const query = breed?.all ? breed.all() : breed;
      return query.other(origin).inRadiusOf(origin, Number(radius));
    }

    function nearestInRadius(origin, breed, radius) {
      return inRadiusQuery(origin, breed, radius).nearestTo(origin);
    }

    function countInRadius(origin, breed, radius) {
      return inRadiusQuery(origin, breed, radius).count();
    }

    function averageHeadingOf(origin, candidates) {
      const flockmates = candidatesToArray(candidates);
      if (flockmates.length === 0) {
        return origin.heading;
      }
      const vector = flockmates.reduce(
        (accumulator, flockmate) => {
          const delta = headingVector(flockmate.heading);
          accumulator.x += delta.x;
          accumulator.y += delta.y;
          return accumulator;
        },
        { x: 0, y: 0 },
      );
      return vectorHeading(vector.x, vector.y, origin.heading);
    }

    function averageHeadingInRadius(origin, breed, radius) {
      return averageHeadingOf(origin, inRadiusQuery(origin, breed, radius));
    }

    function averageHeadingTowards(origin, candidates) {
      const flockmates = candidatesToArray(candidates);
      if (flockmates.length === 0) {
        return origin.heading;
      }
      const vector = flockmates.reduce(
        (accumulator, flockmate) => {
          const heading = headingToObject(origin, flockmate);
          const unit = headingVector(heading);
          accumulator.x += unit.x;
          accumulator.y += unit.y;
          return accumulator;
        },
        { x: 0, y: 0 },
      );
      return vectorHeading(vector.x / flockmates.length, vector.y / flockmates.length, origin.heading);
    }

    function averageHeadingTowardsInRadius(origin, breed, radius) {
      return averageHeadingTowards(origin, inRadiusQuery(origin, breed, radius));
    }

    function refreshPetAtCache() {
      const revision = m.worldController.getRevision();
      if (petAtCacheRevision === revision) {
        return;
      }

      petAtCacheRevision = revision;
      petAtCache.clear();

      for (const pet of m.pets()) {
        const patch = pet.patchHere();
        if (patch) {
          const key = \`\${pet.breed}:\${patch.px},\${patch.py}\`;
          const occupants = petAtCache.get(key);
          if (occupants) {
            occupants.push(pet);
          } else {
            petAtCache.set(key, [pet]);
          }
        }
      }
    }

    function petsAt(breed, x, y) {
      const patch = m.patchAt(x, y);
      if (!patch) {
        return [];
      }

      refreshPetAtCache();
      return petAtCache.get(\`\${breed.name}:\${patch.px},\${patch.py}\`) ?? [];
    }

    function petAt(breed, x, y) {
      const patch = m.patchAt(x, y);
      if (!patch) {
        return undefined;
      }

      refreshPetAtCache();
      return petAtCache.get(\`\${breed.name}:\${patch.px},\${patch.py}\`)?.[0];
    }

    function aroundPetQuery(breed, centerX, centerY) {
      return arrayQuery(
        [
          ...petsAt(breed, Number(centerX) - 1, Number(centerY) - 1),
          ...petsAt(breed, Number(centerX), Number(centerY) - 1),
          ...petsAt(breed, Number(centerX) + 1, Number(centerY) - 1),
          ...petsAt(breed, Number(centerX) - 1, Number(centerY)),
          ...petsAt(breed, Number(centerX) + 1, Number(centerY)),
          ...petsAt(breed, Number(centerX) - 1, Number(centerY) + 1),
          ...petsAt(breed, Number(centerX), Number(centerY) + 1),
          ...petsAt(breed, Number(centerX) + 1, Number(centerY) + 1),
        ],
      );
    }`;
}

function emitMemoryField(field: PetsMemoryField, context: EmitContext) {
  return `    let ${toJsIdentifier(field.name)} = ${emitExpression(field.initialValue, context)};`;
}

function emitDef(def: PetsDef, context: EmitContext) {
  const params = def.params.map((param) => toJsIdentifier(param.name));
  const locals = new Set(def.params.map((param) => param.name));
  const body = def.statements.map((statement) => emitDefStatement(statement, context, locals)).join("\n");

  return `    function ${toJsIdentifier(def.name)}(${params.join(", ")}) {
${body}
    }`;
}

function emitDefStatement(
  statement: PetsDefStatement,
  context: EmitContext,
  locals: Set<string>,
) {
  if (statement.kind === "let") {
    const expression = emitExpression(statement.expression, { ...context, locals });
    locals.add(statement.name);
    return `      const ${toJsIdentifier(statement.name)} = ${expression};`;
  }

  return `      return ${emitExpression(statement.expression, { ...context, locals })};`;
}

function emitParam(param: PetsParam) {
  const name = toJsIdentifier(param.name);

  if (param.control.kind === "slider" && param.type.kind === "number") {
    return `      ${name}: m.editable.number(${param.control.value}, {
        min: ${param.control.min},
        max: ${param.control.max},
        ${param.control.step !== undefined ? `step: ${param.control.step},` : ""}
      })`;
  }

  if (param.control.kind === "toggle" && param.type.kind === "boolean") {
    return `      ${name}: m.editable.boolean(${literal(param.control.value)})`;
  }

  if (param.control.kind === "select" && param.type.kind === "enum") {
    return `      ${name}: m.editable.enum(${literal(param.control.value)}, {
        options: ${JSON.stringify(param.control.options)},
      })`;
  }

  throw new Error(`Unsupported param "${param.name}".`);
}

function emitMonitor(monitor: PetsMonitor, context: EmitContext) {
  const name = toJsIdentifier(monitor.name);
  const expression = emitExpression(monitor.expression, { ...context, agent: undefined });

  if (monitor.type.kind === "number") {
    return `      ${name}: m.readonly.number(() => ${expression})`;
  }

  if (monitor.type.kind === "boolean") {
    return `      ${name}: m.readonly.boolean(() => ${expression})`;
  }

  throw new Error(`Unsupported monitor "${monitor.name}".`);
}

function emitPatchField(field: PetsPatchField) {
  if (field.type.kind === "ref") {
    return `        ${toJsIdentifier(field.name)}: m.refField(${JSON.stringify(field.type.to)})`;
  }
  return `        ${toJsIdentifier(field.name)}: ${literal(field.initialValue)}`;
}

function emitZoneField(field: PetsZoneField) {
  if (field.type.kind === "ref") {
    return `        ${toJsIdentifier(field.name)}: m.refField(${JSON.stringify(field.type.to)})`;
  }
  return `        ${toJsIdentifier(field.name)}: ${literal(field.initialValue)}`;
}

function emitStatement(
  statement: PetsStatement,
  context: EmitContext,
  staged: boolean,
): string {
  if (statement.kind === "create") {
    const count = emitExpression(statement.count, context);
    if (!statement.body || statement.body.length === 0) {
      return `      m.createPets(${toJsIdentifier(statement.breed)}, ${count});`;
    }

    const body = emitAgentActions(
      statement.body,
      {
        ...context,
        agent: "agent",
        agentSet: statement.breed,
        askerAgentSet: statement.breed,
        locals: new Set(),
        queryLocals: new Set(),
      },
      "        ",
      {
        targetAgent: "agent",
        expressionAgent: "agent",
        staged: false,
      },
    );

    return `      m.createPets(${toJsIdentifier(statement.breed)}, ${count}, (agent) => {
${body}
      });`;
  }

  if (statement.kind === "update") {
    return emitAskLike(statement.agentSet, statement.where, statement.body, context, staged);
  }

  if (statement.kind === "repeat") {
    if (statement.index) {
      const repeatContext = cloneExpressionContext(context);
      if (!repeatContext.locals) {
        repeatContext.locals = new Set();
      }
      repeatContext.locals.add(statement.index);
      const start = emitExpression(statement.rangeStart!, context);
      const end = emitExpression(statement.rangeEnd!, context);
      const body: string = statement.body.map((child) => emitStatement(child, repeatContext, staged)).join("\n");
      const varName = toJsIdentifier(statement.index);
      return `      {
        const __start = Math.floor(Number(${start}));
        const __end = Math.floor(Number(${end}));
        for (let __idx = __start; __idx <= __end; __idx += 1) {
          const ${varName} = __idx;
${indentLines(body, 4)}
        }
      }`;
    } else {
      const count = emitExpression(statement.count!, context);
      const body: string = statement.body.map((child) => emitStatement(child, context, staged)).join("\n");
      return `      for (let __repeat = 0; __repeat < Number(${count}); __repeat += 1) {
${indentLines(body, 2)}
      }`;
    }
  }

  if (statement.kind === "command") {
    return `      ${emitCommand(statement, { ...context, agent: undefined })};`;
  }

  return `      ${emitAssignment(statement, { ...context, agent: undefined })};`;
}

/**
 * Emits the optional `brush:` section as a single-patch handler.
 *
 * The handler is registered on the builder; the model exposes it as
 * `applyBrush(px, py)`. Randomness inside the brush uses the same keyed
 * per-agent salts as setup/step, so brushing never perturbs the deterministic
 * random sequence of the running simulation.
 */
function emitBrushSection(actions: PetsAgentAction[], context: EmitContext) {
  const body = emitAgentActions(
    actions,
    {
      ...context,
      agent: "agent",
      agentSet: "patches",
      askerAgentSet: "patches",
      locals: new Set(),
      queryLocals: new Set(),
    },
    "      ",
    {
      targetAgent: "agent",
      expressionAgent: "agent",
      staged: false,
    },
  );

  return `
    m.brush((agent) => {
${body}
    });
`;
}

/**
 * Collects `decide` declarations from non-async turn sections into a
 * breed → field-name list map (source order, deduplicated). Field names stay
 * in source (kebab) form; camelCasing happens at emission.
 */
function collectDecideMap(rounds: PetsRoundSection[]) {
  const decideMap = new Map<string, string[]>();

  for (const turn of rounds) {
    if (turn.mode === "async") {
      continue;
    }

    for (const statement of turn.statements) {
      if (statement.kind !== "update") {
        continue;
      }

      for (const action of statement.body) {
        if (action.kind !== "decide") {
          continue;
        }

        const fields = decideMap.get(statement.agentSet) ?? [];
        for (const field of action.fields) {
          if (!fields.includes(field)) {
            fields.push(field);
          }
        }
        decideMap.set(statement.agentSet, fields);
      }
    }
  }

  return decideMap;
}

/**
 * Emits the one-shot `m.turn({ … })` builder call recording the turn config:
 * the decision deadline and externally decided fields per breed.
 */
function emitRoundConfig(
  rounds: PetsRoundSection[],
  decideMap: Map<string, string[]>,
) {
  const breedKey = (breed: string) =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(breed) ? breed : JSON.stringify(breed);
  const timeoutSeconds = rounds.find((turn) => turn.deadline !== undefined)?.deadline;
  const entries = [...decideMap.entries()].map(([breed, fields]) => {
    return `${breedKey(breed)}: ${JSON.stringify(fields.map((field) => toJsIdentifier(field)))}`;
  });

  return `    m.turn({
      timeoutSeconds: ${timeoutSeconds},
      decide: { ${entries.join(", ")} },
    });
`;
}

/**
 * Removes `decide` statements from barrier turn-section bodies before they
 * are emitted into `world.step` — decisions arrive externally, so the barrier
 * phase emits exactly like a step section minus the declarations.
 */
function stripDecideStatements(statements: PetsStatement[]): PetsStatement[] {
  return statements.map((statement) => {
    if (statement.kind === "update") {
      return { ...statement, body: stripDecideActions(statement.body) };
    }
    if (statement.kind === "create" && statement.body) {
      return { ...statement, body: stripDecideActions(statement.body) };
    }
    if (statement.kind === "repeat") {
      return { ...statement, body: stripDecideStatements(statement.body) };
    }
    return statement;
  });
}

function stripDecideActions(actions: PetsAgentAction[]): PetsAgentAction[] {
  return actions
    .filter((action) => action.kind !== "decide")
    .map((action) => {
      if (action.kind === "where") {
        return {
          ...action,
          body: stripDecideActions(action.body),
          otherwiseBody: action.otherwiseBody ? stripDecideActions(action.otherwiseBody) : undefined,
        };
      }
      if (action.kind === "repeat") {
        return { ...action, body: stripDecideActions(action.body) };
      }
      return action;
    });
}

/**
 * Emits `world.asyncStep = (agentId) => { … }` from `turn async:` sections.
 * Each breed block runs scoped to exactly the agent whose decision arrived,
 * via an id filter ahead of `.ask(...)`.
 */
function emitAsyncStep(asyncRounds: PetsRoundSection[], context: EmitContext) {
  const blocks = asyncRounds.flatMap((turn) =>
    turn.statements.map((statement) => {
      if (statement.kind !== "update") {
        throw new Error("`turn async:` sections only support breed blocks.");
      }

      const query = `${emitAgentSet(statement.agentSet, statement.where, context)}.filter((agent) => agent.id === agentId)`;
      const actions = emitAgentActions(
        statement.body,
        {
          ...context,
          agent: "agent",
          agentSet: statement.agentSet,
          askerAgentSet: statement.agentSet,
          locals: new Set(),
          queryLocals: new Set(),
        },
        "        ",
        {
          targetAgent: "agent",
          expressionAgent: "agent",
          staged: false,
        },
      );

      return `      ${query}.ask((agent) => {
${actions}
      });`;
    }),
  );

  return `
    world.asyncStep = (agentId) => {
${blocks.join("\n")}
    };
`;
}

function emitStepStatements(
  statements: PetsStatement[],
  context: EmitContext,
  staged: boolean,
) {
  if (!staged) {
    return statements.map((statement) => emitStatement(statement, context, false)).join("\n");
  }

  const updateStatements = statements.filter((statement) => statement.kind === "update");
  const otherStatements = statements.filter((statement) => statement.kind !== "update");

  if (updateStatements.length === 0) {
    return statements.map((statement) => emitStatement(statement, context, false)).join("\n");
  }

  const agentSet = updateStatements[0].agentSet;
  if (!updateStatements.every((statement) => statement.agentSet === agentSet)) {
    throw new Error("The MathPets emitter only supports one agentset per staged step.");
  }

  const stagedBlock = `      ${emitAgentSet(agentSet, undefined, context)}.askBatch((agent, draft) => {
${updateStatements.map((statement) => emitStagedUpdateClause(statement, context)).join("\n")}
      });`;

  return [
    stagedBlock,
    ...otherStatements.map((statement) => emitStatement(statement, context, false)),
  ].join("\n");
}

function emitStagedUpdateClause(
  statement: Extract<PetsStatement, { kind: "update" }>,
  context: EmitContext,
) {
  const body = emitAgentActions(
    statement.body,
    {
      ...context,
      agent: "agent",
      agentSet: statement.agentSet,
      askerAgentSet: statement.agentSet,
      locals: new Set(),
      queryLocals: new Set(),
    },
    "        ",
    {
      targetAgent: "draft",
      expressionAgent: "agent",
      staged: true,
    },
  );

  if (!statement.where) {
    return body;
  }

  return `        if (${emitPredicateExpression(statement.where, { ...context, agent: "agent", agentSet: statement.agentSet })}) {
${indentLines(body, 2)}
        }`;
}

function emitAskLike(
  agentSet: string,
  where: PetsExpression | undefined,
  body: PetsAgentAction[],
  context: EmitContext,
  staged: boolean,
) {
  const query = emitAgentSet(agentSet, where, context);

  if (staged) {
    const actions = emitAgentActions(
      body,
      {
        ...context,
        agent: "agent",
        agentSet,
        askerAgentSet: agentSet,
        locals: new Set(),
        queryLocals: new Set(),
      },
      "        ",
      {
        targetAgent: "draft",
        expressionAgent: "agent",
        staged: true,
      },
    );

    return `      ${query}.askBatch((agent, draft) => {
${actions}
      });`;
  }

  const actions = emitAgentActions(
    body,
    {
      ...context,
      agent: "agent",
      agentSet,
      askerAgentSet: agentSet,
      locals: new Set(),
      queryLocals: new Set(),
    },
    "        ",
    {
      targetAgent: "agent",
      expressionAgent: "agent",
      staged: false,
    },
  );

  return `      ${query}.ask((agent) => {
${actions}
      });`;
}

function emitAgentSet(
  agentSet: string,
  where: PetsExpression | undefined,
  context: ExpressionContext,
) {
  const itemAgent = context.agent ? "candidate" : "agent";

  if (agentSet === "patches-in") {
    if (!isPatchesInAgentSet(agentSet, context) || !context.agent) {
      throw new Error("patches-in is only available inside a zone update.");
    }

    const root = `${context.agent}.patchesIn()`;
    if (!where) {
      return root;
    }

    return `${root}.filter((${itemAgent}) => ${emitPredicateExpression(where, {
      ...context,
      agent: itemAgent,
      agentSet: "patches-in",
      selfAgent: context.agent,
    })})`;
  }

  const root =
    agentSet === "patches"
      ? "m.patches()"
      : isZoneAgentSet(agentSet, context)
        ? `arrayQuery(${toJsIdentifier(agentSet)})`
      : agentSet === "links"
        ? "m.links()"
      : isLinkAgentSet(agentSet, context)
        ? `${toJsIdentifier(agentSet)}.all()`
      : agentSet === "pets" || agentSet === "pets" || agentSet === "turtles"
        ? "m.pets()"
        : `m.pets({ breed: ${JSON.stringify(agentSet)} })`;

  if (!where) {
    return root;
  }

  return `${root}.filter((${itemAgent}) => ${emitPredicateExpression(where, { ...context, agent: itemAgent, agentSet })})`;
}

interface AgentActionEmitOptions {
  targetAgent: string;
  expressionAgent: string;
  staged: boolean;
}

function emitAgentActions(
  actions: PetsAgentAction[],
  context: ExpressionContext,
  indent: string,
  options: AgentActionEmitOptions,
) {
  const lines: string[] = [];

  for (const action of actions) {
    if (action.kind === "let") {
      const expression = emitExpression(action.expression, {
        ...context,
        agent: options.expressionAgent,
      });
      lines.push(`${indent}const ${toJsIdentifier(action.name)} = ${expression};`);
      context.locals?.add(action.name);
      if (isQueryExpression(action.expression.source, context)) {
        context.queryLocals?.add(action.name);
      }
      const type = action.type ?? inferExpressionType(action.expression, { ...context, agent: options.expressionAgent }, context.model);
      if (type) {
        context.localTypes?.set(action.name, type);
      }
      continue;
    }

    if (action.kind === "where") {
      const branchContext = cloneExpressionContext(context);
      const condition = emitPredicateExpression(action.condition, {
        ...branchContext,
        agent: options.expressionAgent,
      });
      const consequent = emitAgentActions(
        action.body,
        branchContext,
        `${indent}  `,
        options,
      );

      lines.push(`${indent}if (${condition}) {`);
      if (consequent.length > 0) {
        lines.push(consequent);
      }

      if (action.otherwiseBody) {
        const alternateContext = cloneExpressionContext(context);
        const alternate = emitAgentActions(
          action.otherwiseBody,
          alternateContext,
          `${indent}  `,
          options,
        );
        lines.push(`${indent}} else {`);
        if (alternate.length > 0) {
          lines.push(alternate);
        }
        lines.push(`${indent}}`);
      } else {
        lines.push(`${indent}}`);
      }
      continue;
    }

    if (action.kind === "repeat") {
      const repeatContext = cloneExpressionContext(context);
      if (action.index) {
        if (!repeatContext.locals) {
          repeatContext.locals = new Set();
        }
        repeatContext.locals.add(action.index);
        const start = emitExpression(action.rangeStart!, {
          ...repeatContext,
          agent: options.expressionAgent,
        });
        const end = emitExpression(action.rangeEnd!, {
          ...repeatContext,
          agent: options.expressionAgent,
        });
        const body = emitAgentActions(
          action.body,
          repeatContext,
          `${indent}    `,
          options,
        );
        const varName = toJsIdentifier(action.index);
        lines.push(`${indent}{`);
        lines.push(`${indent}  const __start = Math.floor(Number(${start}));`);
        lines.push(`${indent}  const __end = Math.floor(Number(${end}));`);
        lines.push(`${indent}  for (let __idx = __start; __idx <= __end; __idx += 1) {`);
        lines.push(`${indent}    const ${varName} = __idx;`);
        if (body.length > 0) {
          lines.push(body);
        }
        lines.push(`${indent}  }`);
        lines.push(`${indent}}`);
      } else {
        const count = emitExpression(action.count!, {
          ...repeatContext,
          agent: options.expressionAgent,
        });
        const body = emitAgentActions(
          action.body,
          repeatContext,
          `${indent}  `,
          options,
        );

        lines.push(`${indent}for (let __repeat = 0; __repeat < Number(${count}); __repeat += 1) {`);
        if (body.length > 0) {
          lines.push(body);
        }
        lines.push(`${indent}}`);
      }
      continue;
    }

    if (action.kind === "command") {
      if (options.staged) {
        throw new Error("Staged steps do not support pet commands. Use a non-staged step for movement.");
      }
      lines.push(`${indent}${emitCommand(action, { ...context, agent: options.targetAgent })};`);
      continue;
    }

    if (action.kind === "decide") {
      // `decide` declarations are configuration (collected into `m.round`),
      // not runtime behavior — they emit nothing.
      continue;
    }

    if (action.kind === "action-call") {
      const resolved = resolvePetAction(action.name, context);
      if (context.actionStack?.includes(resolved.key)) {
        throw new Error(`Recursive pet action "${action.name}" is not supported.`);
      }

      const declaredParams = resolved.action.params ?? [];
      const passedArgs = action.args ?? [];

      // Enforce: parens iff arguments (zero-arg calls must have no parens)
      if (declaredParams.length === 0 && action.hasParens) {
        throw new Error(`Zero-parameter action "${action.name}" must be called without parentheses.`);
      }
      if (declaredParams.length > 0 && !action.hasParens) {
        throw new Error(`Parameterized action "${action.name}" must be called with parentheses.`);
      }

      // Check arity
      if (declaredParams.length !== passedArgs.length) {
        const signature = `${action.name}(${declaredParams.map((p) => `${p.name}: ${formatType(p.type)}`).join(", ")})`;
        throw new Error(
          `Arity mismatch calling action "${action.name}" with signature \`${signature}\`: expected ${declaredParams.length} arguments, got ${passedArgs.length}.`
        );
      }

      // Check types
      declaredParams.forEach((param, i) => {
        const arg = passedArgs[i];
        const actualType = inferExpressionType(arg, context, context.model);
        if (actualType && !typesMatch(param.type, actualType)) {
          const signature = `${action.name}(${declaredParams.map((p) => `${p.name}: ${formatType(p.type)}`).join(", ")})`;
          throw new Error(
            `Type mismatch calling action "${action.name}" with signature \`${signature}\` for parameter "${param.name}": expected ${formatType(param.type)}, got "${arg.source}" of type ${formatType(actualType)}.`
          );
        }
      });

      // Expand macro
      let expanded = "";
      if (declaredParams.length > 0) {
        const argDeclarations: string[] = [];
        const paramDeclarations: string[] = [];
        const nextLocals = new Set(context.locals);
        const nextLocalTypes = new Map(context.localTypes);

        declaredParams.forEach((param, i) => {
          const arg = passedArgs[i];
          const argVal = emitExpression(arg, context);
          const tempVarName = `__action_arg_${context.protectionCounter.next}_${i}`;
          argDeclarations.push(`${indent}const ${tempVarName} = ${argVal};`);

          const paramJsName = toJsIdentifier(param.name);
          paramDeclarations.push(`${indent}const ${paramJsName} = ${tempVarName};`);
          nextLocals.add(param.name);
          nextLocalTypes.set(param.name, param.type);
        });
        context.protectionCounter.next += 1;

        const actionContext = {
          ...cloneExpressionContext(context),
          locals: nextLocals,
          localTypes: nextLocalTypes,
          actionStack: [...(context.actionStack ?? []), resolved.key],
        };
        const bodyContent = emitAgentActions(resolved.action.body, actionContext, indent + "  ", options);
        expanded = [
          `${indent}{`,
          ...argDeclarations,
          ...paramDeclarations,
          bodyContent,
          `${indent}}`
        ].filter(Boolean).join("\n");
      } else {
        const actionContext = {
          ...cloneExpressionContext(context),
          actionStack: [...(context.actionStack ?? []), resolved.key],
        };
        const bodyContent = emitAgentActions(resolved.action.body, actionContext, indent, options);
        expanded = bodyContent;
      }

      if (expanded.length > 0) {
        lines.push(expanded);
      }
      continue;
    }

    lines.push(`${indent}${emitAssignment(
      action,
      { ...context, agent: options.targetAgent },
      options.expressionAgent,
    )};`);
  }

  return lines.join("\n");
}

function resolvePetAction(name: string, context: ExpressionContext) {
  if (!context.agentSet || !isPetAgentSet(context.agentSet, context)) {
    throw new Error(`Pet action "${name}" can only be called inside a pet or breed update.`);
  }

  const breedAction = context.breedActions.get(context.agentSet)?.get(name);
  if (breedAction) {
    return {
      action: breedAction,
      key: `${context.agentSet}:${name}`,
    };
  }

  const sharedAction = context.petActions.get(name);
  if (sharedAction) {
    return {
      action: sharedAction,
      key: `pets:${name}`,
    };
  }

  throw new Error(`Unknown pet action "${name}" for agentset "${context.agentSet}".`);
}

function cloneExpressionContext(context: ExpressionContext): ExpressionContext {
  return {
    ...context,
    locals: new Set(context.locals),
    localTypes: new Map(context.localTypes),
    queryLocals: new Set(context.queryLocals),
  };
}

function nextRandomSalt(context: EmitContext) {
  const salt = context.randomSaltCounter.next;
  context.randomSaltCounter.next += 1;
  return salt;
}

function isQueryExpression(source: string, context: ExpressionContext) {
  const trimmed = source.trim();
  const parsedAgentSet = parseAgentSetExpression(trimmed);

  if (parsedAgentSet && isKnownAgentSetExpression(parsedAgentSet, context)) {
    return true;
  }

  if (/\brandom\b/.test(trimmed)) {
    return true;
  }

  if (/^(other\s+)?(patches|pets|pets|turtles|links|[A-Za-z][A-Za-z0-9_-]*)$/.test(trimmed)) {
    const agentSet = trimmed.replace(/^other\s+/, "");
    if (
      context.queryLocals?.has(agentSet) ||
      isPatchLikeAgentSet(agentSet, context) ||
      isZoneAgentSet(agentSet, context) ||
      isPetAgentSet(agentSet, context) ||
      isLinkAgentSet(agentSet, context)
    ) {
      return true;
    }
  }

  if (/^patches\s+(in-radius|in-square)\s+.+?\s+around\s*\(.+\)$/.test(trimmed)) {
    return true;
  }

  if (/^[A-Za-z][A-Za-z0-9_-]*\s+in-radius\s+.+$/.test(trimmed)) {
    return true;
  }

  const aroundQuery = readAroundQueryParts(trimmed, 0, context);
  if (aroundQuery && aroundQuery.endIndex === trimmed.length) {
    return true;
  }

  const directedNeighborQuery = readDirectedPatchNeighborQueryParts(trimmed, 0);
  if (directedNeighborQuery && directedNeighborQuery.endIndex === trimmed.length) {
    return true;
  }

  const whereMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*|patches|pets|pets|turtles|links|neighbors4|neighbors8)\s+where\b/);
  return Boolean(whereMatch && (
    isPatchAgentSet(whereMatch[1]) ||
    isPatchesInAgentSet(whereMatch[1], context) ||
    isZoneAgentSet(whereMatch[1], context) ||
    isPetAgentSet(whereMatch[1], context) ||
    isLinkAgentSet(whereMatch[1], context) ||
    whereMatch[1] === "neighbors4" ||
    whereMatch[1] === "neighbors8" ||
    context.queryLocals?.has(whereMatch[1])
  ));
}

function indentLines(source: string, spaces: number) {
  const prefix = " ".repeat(spaces);
  return source
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function inferTargetType(target: string, context: ExpressionContext): PetsType | null {
  const trimmed = target.trim();
  
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed)) {
    if (context.agentSet) {
      const breed = context.model.pets.find((b) => b.name === context.agentSet);
      if (breed) {
        const field = breed.fields.find((f) => f.name === trimmed);
        if (field) return field.type;
      }
      const link = context.model.links.find((b) => b.name === context.agentSet);
      if (link) {
        const field = link.fields.find((f) => f.name === trimmed);
        if (field) return field.type;
      }
      const zone = context.model.zones.find((z) => z.name === context.agentSet);
      if (zone) {
        const field = zone.fields.find((f) => f.name === trimmed);
        if (field) return field.type;
      }
    }
    const patchField = context.model.patches.find((f) => f.name === trimmed);
    if (patchField) return patchField.type;

    const mem = context.model.memory.find((m) => m.name === trimmed);
    if (mem) return mem.type;
  }

  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)$/);
  if (match) {
    const objName = match[1];
    const fieldName = match[2];
    if (objName === "patch") {
      const patchField = context.model.patches.find((f) => f.name === fieldName);
      if (patchField) return patchField.type;
    }
    
    if (objName === "self" && context.agentSet) {
      const breed = context.model.pets.find((b) => b.name === context.agentSet);
      if (breed) {
        const field = breed.fields.find((f) => f.name === fieldName);
        if (field) return field.type;
      }
      const link = context.model.links.find((b) => b.name === context.agentSet);
      if (link) {
        const field = link.fields.find((f) => f.name === fieldName);
        if (field) return field.type;
      }
    }

    if (context.localTypes && context.localTypes.has(objName)) {
      const objType = context.localTypes.get(objName);
      if (objType && objType.kind === "ref") {
        if (objType.to === "patch") {
          const patchField = context.model.patches.find((f) => f.name === fieldName);
          if (patchField) return patchField.type;
        } else {
          const breed = context.model.pets.find((b) => b.name === objType.to) ||
                        context.model.links.find((l) => l.name === objType.to);
          if (breed) {
            const field = breed.fields.find((f) => f.name === fieldName);
            if (field) return field.type;
          }
        }
      }
    }
  }

  return null;
}

function emitAssignment(
  assignment: PetsAssignment,
  context: ExpressionContext,
  expressionAgent = context.agent,
) {
  // Only ref-typed targets are type-checked: the expression inferrer is a
  // shallow heuristic that cannot be trusted on general arithmetic and
  // comparison forms, but ref assignments (breed/patch references, nobody,
  // self, query results) have unambiguous shapes.
  const targetType = inferTargetType(assignment.target, context);
  if (targetType?.kind === "ref") {
    const exprType = inferExpressionType(assignment.expression, { ...context, agent: expressionAgent }, context.model);
    if (exprType && !typesMatch(targetType, exprType)) {
      throw new Error(`Type mismatch: cannot assign "${formatType(exprType)}" to field "${assignment.target.trim()}" of type "${formatType(targetType)}".`);
    }
  }

  const target = emitAssignmentTarget(assignment.target, context);
  return `${target} = ${emitExpression(assignment.expression, { ...context, agent: expressionAgent })}`;
}

function emitAssignmentTarget(target: string, context: ExpressionContext) {
  const trimmed = target.trim();

  if (trimmed.startsWith("mine.") || trimmed === "mine") {
    throw new Error("`mine` is read-only and cannot be assigned to.");
  }

  if (context.agent) {
    const fieldTarget = emitWritableFieldAccess(trimmed, context);
    if (fieldTarget) {
      return fieldTarget;
    }

    return `${context.agent}.${toJsIdentifier(trimmed)}`;
  }

  return toJsIdentifier(trimmed);
}

function emitCommand(command: PetsCommandStatement, context: ExpressionContext) {
  const agent = context.agent ?? "agent";

  if (command.command === "diffuse") {
    requireCommandArity(command, 2);
    // Field names camelize like every other field reference: without this,
    // `diffuse(seen-top, 0.1)` would target the nonexistent key "seen-top"
    // and silently zero the real field.
    const diffuseField = JSON.stringify(toJsIdentifier(command.args[0].source));
    if (command.overBreed) {
      return `m.diffuseLinks(${diffuseField}, ${emitExpression(command.args[1], context)}, ${emitLinkBreedReference(command.overBreed, context)})`;
    }
    return `m.diffuse(${diffuseField}, ${emitExpression(command.args[1], context)})`;
  }

  if (command.command === "forward") {
    requireCommandArity(command, 1);
    return `${agent}.forward(${emitExpression(command.args[0], context)})`;
  }

  if (command.command === "turn") {
    requireCommandArity(command, 1);
    return `${agent}.turn(${emitExpression(command.args[0], context)})`;
  }

  if (command.command === "face") {
    if (command.args.length < 1 || command.args.length > 2) {
      throw new Error("face requires an object and optional percent.");
    }

    const target = emitExpression(command.args[0], context);
    const percent = command.args[1] ? emitExpression(command.args[1], context) : "100";
    return `faceTowards(${agent}, ${target}, ${percent})`;
  }

  if (command.command === "set-position") {
    requireCommandArity(command, 2);
    return `setPosition(${agent}, ${emitExpression(command.args[0], context)}, ${emitExpression(command.args[1], context)})`;
  }

  if (command.command === "move-to") {
    requireCommandArity(command, 1);
    return `moveTo(${agent}, ${emitExpression(command.args[0], context)})`;
  }

  if (command.command === "scatter") {
    if (command.args.length < 1 || command.args.length > 3) {
      throw new Error("scatter requires a spread and an optional anchor (`from <agent>` or `from <x>, <y>`).");
    }

    const spread = emitExpression(command.args[0], context);
    const anchor =
      command.args.length === 1
        ? agent
        : command.args.length === 2
          ? emitExpression(command.args[1], context)
          : `{ x: ${emitExpression(command.args[1], context)}, y: ${emitExpression(command.args[2], context)} }`;
    return `scatterFrom(${agent}, ${anchor}, ${spread}, ${nextRandomSalt(context)}, ${nextRandomSalt(context)})`;
  }

  if (command.command === "die") {
    requireCommandArity(command, 0);
    return `m.removePet(${agent})`;
  }

  if (command.command === "hatch") {
    if (command.args.length > 1) {
      throw new Error("hatch requires an optional breed argument.");
    }
    const breed = command.args[0] ? emitPetBreedReference(command.args[0].source, context) : undefined;
    return breed
      ? `hatchFrom(${agent}, ${breed}, ${nextRandomSalt(context)})`
      : `hatchFrom(${agent}, undefined, ${nextRandomSalt(context)})`;
  }

  if (command.command === "kill") {
    requireCommandArity(command, 1);
    const target = emitExpression(command.args[0], context);
    return `(() => {
      const victim = ${target};
      if (victim === undefined || victim === null) {
        throw new Error("Cannot kill nobody — agent is already missing or dead.");
      }
      m.removePet(victim);
    })()`;
  }

  if (command.command === "kill-one") {
    throw new Error("kill-one was removed — write `let prey = one-of breed here` followed by `where (prey): kill(prey)`.");
  }

  if (command.command === "create-link-with" || command.command === "create-link-to") {
    requireCommandArity(command, 2);
    const breed = emitLinkBreedReference(command.args[0].source, context);
    const target = emitExpression(command.args[1], context);
    return `m.createLink(${breed}, ${agent}, ${target})`;
  }

  if (command.command === "die-link") {
    requireCommandArity(command, 0);
    return `m.removeLink(${agent})`;
  }

  if (command.command === "turn-towards") {
    requireCommandArity(command, 2);
    return `turnTowardsValue(${agent}, ${emitExpression(command.args[0], context)}, ${emitExpression(command.args[1], context)})`;
  }

  if (command.command === "turn-away") {
    requireCommandArity(command, 2);
    return `turnAwayFromValue(${agent}, ${emitExpression(command.args[0], context)}, ${emitExpression(command.args[1], context)})`;
  }

  if (command.command === "follow-patch-gradient") {
    if (command.args.length !== 1 && command.args.length !== 3 && command.args.length !== 5) {
      throw new Error("follow-patch-gradient requires a patch field, optional min/max, and optional turn angle/distance.");
    }

    const field = JSON.stringify(toJsIdentifier(command.args[0].source));
    const minValue = command.args[1] ? emitExpression(command.args[1], context) : "undefined";
    const maxValue = command.args[2] ? emitExpression(command.args[2], context) : "undefined";
    const turnAngle = command.args[3] ? emitExpression(command.args[3], context) : "45";
    const distance = command.args[4] ? emitExpression(command.args[4], context) : "1";
    return `followPatchGradient(${agent}, ${field}, ${minValue}, ${maxValue}, ${turnAngle}, ${distance}, ${nextRandomSalt(context)})`;
  }

  if (command.command === "set-random-position") {
    requireCommandArity(command, 0);
    return `setRandomPosition(${agent}, ${nextRandomSalt(context)}, ${nextRandomSalt(context)})`;
  }

  requireCommandArity(command, 0);
  return `${agent}.setRandomPosition()`;
}

function requireCommandArity(command: PetsCommandStatement, expected: number) {
  if (command.args.length !== expected) {
    throw new Error(`${command.command} requires ${expected} argument${expected === 1 ? "" : "s"}.`);
  }
}

function emitExpression(expression: PetsExpression, context: ExpressionContext) {
  return lowerExpression(expression.source, context);
}

function emitPredicateExpression(expression: PetsExpression, context: ExpressionContext) {
  return lowerExpression(expression.source, { ...context, statePredicate: true });
}

function lowerExpression(source: string, context: ExpressionContext): string {
  if (source.includes("patch-here")) {
    throw new Error("`patch-here()` was renamed — use the `patch` property (e.g. `patch.has-grass`).");
  }

  const ifExpression = lowerIfExpression(source, context);
  if (ifExpression) {
    return ifExpression;
  }

  let next = source.trim();
  const protectionScope = context.protectionCounter.next;
  context.protectionCounter.next += 1;
  const protectedSnippets: string[] = [];
  const protect = (code: string) => {
    const key = `__PETS_EXPR_${protectionScope}_${protectedSnippets.length}__`;
    protectedSnippets.push(code);
    return key;
  };
  const restoreProtected = (code: string) => {
    let restored = code;

    for (let pass = 0; pass <= protectedSnippets.length; pass += 1) {
      const nextRestored = restored.replace(
        /__PETS_EXPR_(\d+)_(\d+)__/g,
        (match, scope: string, index: string) =>
          Number(scope) === protectionScope
            ? protectedSnippets[Number(index)] ?? ""
            : match,
      );

      if (nextRestored === restored) {
        return restored;
      }

      restored = nextRestored;
    }

    return restored;
  };

  const wholeQueryExpression = lowerWholeQueryExpression(next, context);
  if (wholeQueryExpression) {
    return wholeQueryExpression;
  }

  next = replacePatchRegionPredicateCalls(next, context, protect);
  next = replaceRandomSubsetQueries(next, context, protect);
  next = replaceNearestInRadiusFieldAccess(next, context, protect);
  next = replaceMovementReporterFieldAccess(next, context, protect);
  next = replaceMovementReporterCall(next, context, protect);
  next = replaceDirectedPatchNeighborFieldAccess(next, context, protect);
  next = replaceZoneAtFieldAccess(next, context, protect);
  next = replacePatchAtFieldAccess(next, context, protect);
  next = replacePatchPropertyAccess(next, context, protect);
  next = replaceRefPropertyAccess(next, context, protect);
  next = replacePetAtFieldAccess(next, context, protect);
  next = replaceLinkEndpointFieldAccess(next, context, protect);
  next = replaceZoneAtCall(next, context, protect);
  next = replacePatchAtCall(next, context, protect);
  next = replacePetAtCall(next, context, protect);
  next = replaceLinkEndpointCall(next, context, protect);
  next = replaceSpatialHelperCalls(next, context, protect);
  next = replaceAroundAggregateExpressions(next, context, protect);
  next = replaceAroundCountExpressions(next, context, protect);
  next = replaceDirectedPatchNeighborCountAnyExpressions(next, context, protect);
  next = replacePatchNeighborCountAnyExpressions(next, context, protect);
  next = replaceGenericCountAny(next, context, protect);
  next = replaceDirectedPatchNeighborCall(next, context, protect);
  next = replaceNearestExpression(next, context, protect);
  next = replaceRandomCalls(next, context, protect);

  next = next.replace(
    /\b(sum|mean|min|max)\s+(patches|pets|pets|turtles|links|[A-Za-z][A-Za-z0-9_-]*)(?:\s+where\s+\(([^()]*)\))?\s+report\s+\(([^()]*)\)/g,
    (_match, aggregate: "sum" | "mean" | "min" | "max", agentSet: string, condition: string | undefined, expressionSource: string) => {
      if (!isPatchLikeAgentSet(agentSet, context) && !isZoneAgentSet(agentSet, context) && !isPetAgentSet(agentSet, context) && !isLinkAgentSet(agentSet, context)) {
        return _match;
      }

      const outerAgent = context.agent;
      const itemAgent = outerAgent ? "candidate" : "agent";
      const query = condition
        ? `${emitAgentSet(agentSet, undefined, context)}.filter((${itemAgent}) => ${lowerExpression(condition, { ...context, agent: itemAgent, agentSet, selfAgent: outerAgent, statePredicate: true })})`
        : emitAgentSet(agentSet, undefined, context);
      const valueExpression = lowerExpression(expressionSource, { ...context, agent: itemAgent, agentSet, selfAgent: outerAgent });
      const valuesExpression = `${query}.map((${itemAgent}) => Number(${valueExpression}))`;
      const sumExpression = `${valuesExpression}.reduce((total, value) => total + value, 0)`;

      if (aggregate === "sum") {
        return protect(sumExpression);
      }

      if (aggregate === "mean") {
        return protect(`(() => { const values = ${valuesExpression}; return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length; })()`);
      }

      if (aggregate === "min") {
        return protect(`(() => { const values = ${valuesExpression}; return values.length === 0 ? 0 : Math.min(...values); })()`);
      }

      return protect(`(() => { const values = ${valuesExpression}; return values.length === 0 ? 0 : Math.max(...values); })()`);
    },
  );

  next = next.replace(
    /count\s+patches(?!-)\s+where\s+\(([^()]*)\)/g,
    (_match, condition: string) => {
      const outerAgent = context.agent;
      const itemAgent = outerAgent ? "candidate" : "agent";
      return protect(`m.countPatches((${itemAgent}) => ${lowerExpression(condition, { ...context, agent: itemAgent, agentSet: "patches", selfAgent: outerAgent, statePredicate: true })})`);
    },
  );

  next = next.replace(
    /count\s+patches(?!-)\s+where\s+([A-Za-z][A-Za-z0-9_-]*)\b/g,
    (_match, state: string) => {
      const outerAgent = context.agent;
      const itemAgent = outerAgent ? "candidate" : "agent";
      return protect(`m.countPatches((${itemAgent}) => ${emitStatePredicate(state, { ...context, agent: itemAgent, agentSet: "patches", selfAgent: outerAgent })})`);
    },
  );

  next = next.replace(/\bcount\s+patches(?!-)\b/g, () => protect("m.countPatches()"));

  // Call-shaped link agentsets or paren-less link-neighbors (`count in-links(defers)`, `any out-links()`, `count link-neighbors`)
  // must lower before the bare-identifier passes below: left alone, the
  // generic identifier pass camelizes them into invalid JavaScript like
  // `count inLinks(defers)`.
  next = next.replace(
    /\b(count|any)\s+(link-neighbors|links-with|in-link-neighbors|out-link-neighbors|in-links|out-links)(?:\s*\(([^()]*)\))?/g,
    (_match, reporter: string, callable: string, args: string | undefined) => {
      if (args === undefined && callable !== "link-neighbors") {
        return _match;
      }
      const exprSource = args !== undefined ? `${callable}(${args})` : callable;
      const expression = parseAgentSetExpression(exprSource);
      if (!expression) {
        return _match;
      }

      const count = `${emitAgentSetExpression(expression, context)}.count()`;
      return protect(reporter === "any" ? `(${count} > 0)` : count);
    },
  );

  next = next.replace(
    /count\s+([A-Za-z][A-Za-z0-9_-]*)\s+where\s+\(([^()]*)\)/g,
    (_match, agentSet: string, condition: string) => {
      if (context.queryLocals?.has(agentSet)) {
        const outerAgent = context.agent;
        return protect(`${toJsIdentifier(agentSet)}.filter((candidate) => ${lowerExpression(condition, { ...context, agent: "candidate", selfAgent: outerAgent, statePredicate: true })}).count()`);
      }

      if (!isPatchLikeAgentSet(agentSet, context) && !isZoneAgentSet(agentSet, context) && !isPetAgentSet(agentSet, context) && !isLinkAgentSet(agentSet, context)) {
        return _match;
      }

      const outerAgent = context.agent;
      const itemAgent = outerAgent ? "candidate" : "agent";
      return protect(`${emitAgentSet(agentSet, undefined, context)}.filter((${itemAgent}) => ${lowerExpression(condition, { ...context, agent: itemAgent, agentSet, selfAgent: outerAgent, statePredicate: true })}).count()`);
    },
  );

  next = next.replace(
    /count\s+([A-Za-z][A-Za-z0-9_-]*)\s+where\s+([A-Za-z][A-Za-z0-9_-]*)\b/g,
    (_match, agentSet: string, state: string) => {
      if (context.queryLocals?.has(agentSet)) {
        const outerAgent = context.agent;
        return protect(`${toJsIdentifier(agentSet)}.filter((candidate) => ${emitStatePredicate(state, { ...context, agent: "candidate", selfAgent: outerAgent })}).count()`);
      }

      if (!isPatchLikeAgentSet(agentSet, context) && !isZoneAgentSet(agentSet, context) && !isPetAgentSet(agentSet, context) && !isLinkAgentSet(agentSet, context)) {
        return _match;
      }

      const outerAgent = context.agent;
      const itemAgent = outerAgent ? "candidate" : "agent";
      return protect(`${emitAgentSet(agentSet, undefined, context)}.filter((${itemAgent}) => ${emitStatePredicate(state, { ...context, agent: itemAgent, agentSet, selfAgent: outerAgent })}).count()`);
    },
  );

  next = next.replace(
    /\bcount\s+([A-Za-z][A-Za-z0-9_-]*)\b/g,
    (_match, agentSet: string) => {
      if (context.queryLocals?.has(agentSet)) {
        return protect(`${toJsIdentifier(agentSet)}.count()`);
      }

      if (!isPatchLikeAgentSet(agentSet, context) && !isZoneAgentSet(agentSet, context) && !isPetAgentSet(agentSet, context) && !isLinkAgentSet(agentSet, context)) {
        return _match;
      }

      return protect(`${emitAgentSet(agentSet, undefined, context)}.count()`);
    },
  );

  next = replaceSelfFieldCall(next, context, protect);
  next = replaceMineFieldCall(next, context, protect);
  next = replaceMembershipExpressions(next, context, protect, restoreProtected);

  if (context.statePredicate) {
    next = protectBareStatePredicates(next, context, protect);
  }

  next = next.replace(/\band\b/g, "&&");
  next = next.replace(/\bor\b/g, "||");
  next = next.replace(/\bnot\b/g, "!");
  next = next.replace(/(^|[^<>=!])=([^=])/g, "$1===$2");

  next = next.replace(
    /\b[A-Za-z][A-Za-z0-9_-]*\b/g,
    (identifier, offset: number, whole: string) =>
      // Identifiers in member position (`q.posture`) name a field on the
      // object to their left — camelize them, but never resolve them against
      // the current agent context (that would emit `q.agent.posture`).
      whole[offset - 1] === "."
        ? toJsIdentifier(identifier)
        : resolveIdentifier(identifier, context),
  );

  next = restoreProtected(next);

  return next;
}

function lowerWholeQueryExpression(source: string, context: ExpressionContext) {
  const trimmed = source.trim();
  const rankedOneOfReporter = parseRankedOneOfReporter(trimmed);
  if (rankedOneOfReporter) {
    return emitRankedOneOfReporter(rankedOneOfReporter, context);
  }

  const oneOfReporter = parseOneOfReporter(trimmed);
  if (oneOfReporter) {
    return `${lowerExpression(oneOfReporter.querySource, context)}.oneOf()`;
  }

  const agentSetReporter = parseAgentSetReporterExpression(trimmed);
  if (agentSetReporter) {
    return emitAgentSetReporterExpression(agentSetReporter, context);
  }

  // count/any over a composed agentset expression (`any sheep here`,
  // `count other wolves here`) — plain named sets and where-queries lower
  // through their dedicated passes.
  const countAnyComposed = trimmed.match(/^(count|any)\s+(.+\bhere)$/);
  if (countAnyComposed) {
    const composedQuery = parseAgentSetExpression(countAnyComposed[2]);
    if (composedQuery && isKnownAgentSetExpression(composedQuery, context)) {
      const emitted = emitAgentSetExpression(composedQuery, context);
      return countAnyComposed[1] === "count" ? `${emitted}.count()` : `(${emitted}.count() > 0)`;
    }
  }

  const agentSetExpression = parseAgentSetExpression(trimmed);
  if (agentSetExpression && isKnownAgentSetExpression(agentSetExpression, context)) {
    return emitAgentSetExpression(agentSetExpression, context);
  }

  const patchRegionMatch = trimmed.match(/^patches\s+(in-radius|in-square)\s+(.+?)(?:\s+around\s*\((.*)\))?$/);
  if (patchRegionMatch) {
    const shape = patchRegionMatch[1];
    const radius = patchRegionMatch[2];
    const aroundClause = patchRegionMatch[3];

    let cx: string;
    let cy: string;

    if (aroundClause === undefined) {
      if (!context.agent) {
        throw new Error("An explicit center is needed outside agent context.");
      }
      if (isPetAgentSet(context.agentSet, context) || isZoneAgentSet(context.agentSet, context)) {
        cx = `${context.agent}.x`;
        cy = `${context.agent}.y`;
      } else if (isPatchLikeAgentSet(context.agentSet, context)) {
        cx = `${context.agent}.px`;
        cy = `${context.agent}.py`;
      } else {
        throw new Error("An explicit center is needed outside agent context.");
      }
    } else {
      const coordinates = splitTopLevelCommas(aroundClause);
      if (coordinates.length !== 2) {
        throw new Error(`Patch ${shape} regions use around (x, y).`);
      }
      cx = lowerExpression(coordinates[0], context);
      cy = lowerExpression(coordinates[1], context);
    }

    const helper = shape === "in-radius" ? "patchInRadius" : "patchInSquare";
    return `m.patches().filter((candidate) => ${helper}(candidate, ${lowerExpression(radius, context)}, ${cx}, ${cy}))`;
  }

  const inRadiusMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\s+in-radius\s+(.+)$/);
  if (inRadiusMatch) {
    const agent = context.agent ?? "agent";
    return `inRadiusQuery(${agent}, ${lowerExpression(inRadiusMatch[1], { ...context, statePredicate: false })}, ${lowerExpression(inRadiusMatch[2], { ...context, statePredicate: false })})`;
  }

  const aroundQuery = readAroundQueryParts(trimmed, 0, context);
  if (aroundQuery && aroundQuery.endIndex === trimmed.length) {
    return emitAroundQueryWithWhere(
      aroundQuery.agentSet,
      aroundQuery.where,
      aroundQuery.around,
      context,
    );
  }

  const directedNeighborQuery = readDirectedPatchNeighborQueryParts(trimmed, 0);
  if (directedNeighborQuery && directedNeighborQuery.endIndex === trimmed.length) {
    return emitDirectedPatchNeighborQueryWithWhere(
      directedNeighborQuery.argsSource,
      directedNeighborQuery.where,
      context,
    );
  }

  const whereMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_-]*|patches|pets|pets|turtles|links|neighbors4|neighbors8)\s+where\s+(?:\((.*)\)|([A-Za-z][A-Za-z0-9_-]*))$/,
  );
  if (!whereMatch) {
    return null;
  }

  const [, agentSet, condition, state] = whereMatch;
  if (agentSet === "neighbors4" || agentSet === "neighbors8") {
    const agent = context.agent ?? "agent";
    return condition
      ? `${agent}.${agentSet}((neighbor) => ${lowerExpression(condition, { ...context, agent: "neighbor", statePredicate: true })})`
      : `${agent}.${agentSet}((neighbor) => ${emitStatePredicate(state, { ...context, agent: "neighbor" })})`;
  }

  if (context.queryLocals?.has(agentSet)) {
    return condition
      ? `${toJsIdentifier(agentSet)}.filter((candidate) => ${lowerExpression(condition, { ...context, agent: "candidate", selfAgent: context.agent, statePredicate: true })})`
      : `${toJsIdentifier(agentSet)}.filter((candidate) => ${emitStatePredicate(state, { ...context, agent: "candidate", selfAgent: context.agent })})`;
  }

  if (!isPatchLikeAgentSet(agentSet, context) && !isZoneAgentSet(agentSet, context) && !isPetAgentSet(agentSet, context) && !isLinkAgentSet(agentSet, context)) {
    return null;
  }

  return emitAgentSet(
    agentSet,
    condition
      ? { source: condition.trim() }
      : state
        ? { source: `state = ${state}` }
        : undefined,
    context,
  );
}

interface RankedOneOfReporter {
  kind: "max-one-of" | "min-one-of";
  querySource: string;
  reportSource: string;
}

function parseOneOfReporter(source: string) {
  const match = source.match(/^one-of\s+(.+)$/);
  if (!match) {
    return null;
  }

  return {
    querySource: match[1].trim(),
  };
}

function parseRankedOneOfReporter(source: string): RankedOneOfReporter | null {
  const match = /^(max-one-of|min-one-of)\s+/.exec(source);
  if (!match) {
    return null;
  }

  const reportIndex = findTopLevelKeyword(source, "report");
  if (reportIndex < 0) {
    throw new Error(`${match[1]} requires \`report (...)\`.`);
  }

  const expressionStart = skipSpaces(source, reportIndex + "report".length);
  if (source[expressionStart] !== "(") {
    throw new Error(`${match[1]} requires \`report (...)\`.`);
  }

  const expressionEnd = findMatchingParen(source, expressionStart);
  if (expressionEnd < 0 || skipSpaces(source, expressionEnd + 1) !== source.length) {
    throw new Error(`${match[1]} requires a single parenthesized report expression.`);
  }

  return {
    kind: match[1] as RankedOneOfReporter["kind"],
    querySource: source.slice(match[0].length, reportIndex).trim(),
    reportSource: source.slice(expressionStart + 1, expressionEnd),
  };
}

function emitRankedOneOfReporter(
  reporter: RankedOneOfReporter,
  context: ExpressionContext,
) {
  const query = lowerExpression(reporter.querySource, context);
  const agentSet = inferAgentSetFromQuerySource(reporter.querySource, context);
  const score = lowerExpression(reporter.reportSource, {
    ...context,
    agent: "candidate",
    agentSet,
    selfAgent: context.agent,
    statePredicate: false,
  });
  const mode = reporter.kind === "max-one-of" ? "max" : "min";
  return `rankedOneOf(${context.agent ?? "undefined"}, ${query}, (candidate) => Number(${score}), ${JSON.stringify(mode)}, ${nextRandomSalt(context)})`;
}

function inferAgentSetFromQuerySource(source: string, context: ExpressionContext) {
  const trimmed = source.trim();
  const firstToken = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\b/)?.[1];
  if (!firstToken) {
    return context.agentSet;
  }

  if (
    isPatchLikeAgentSet(firstToken, context) ||
    isZoneAgentSet(firstToken, context) ||
    isPetAgentSet(firstToken, context) ||
    isLinkAgentSet(firstToken, context)
  ) {
    return firstToken;
  }

  return context.agentSet;
}

function lowerQueryExpressionSource(
  source: string,
  context: ExpressionContext,
  allowNull = false,
): string {
  const expression = parseAgentSetExpression(source);
  if (expression && isKnownAgentSetExpression(expression, context)) {
    return emitAgentSetExpression(expression, context);
  }

  if (allowNull) {
    return "";
  }

  throw new Error(`Expected an agentset expression, received "${source.trim()}".`);
}

function emitAgentSetReporterExpression(
  expression: PetsAgentSetReporterExpression,
  context: ExpressionContext,
) {
  if (expression.kind === "one-of") {
    return `${emitAgentSetExpression(expression.source, context)}.oneOf()`;
  }

  throw new Error(`Unsupported agentset reporter ${(expression as { kind: string }).kind}.`);
}

function inferAgentSetFromExpression(
  expression: PetsAgentSetExpression,
  context: ExpressionContext,
): string | undefined {
  if (expression.kind === "named") {
    // Query locals carry no field-kind of their own — predicates over them
    // qualify identifiers against the enclosing block's agentset, exactly
    // like the dedicated query-local count path.
    if (context.queryLocals?.has(expression.name)) {
      return context.agentSet;
    }
    return expression.name;
  }
  if (expression.kind === "here" || expression.kind === "other" || expression.kind === "n-of" || expression.kind === "where") {
    return inferAgentSetFromExpression(expression.source, context);
  }
  return context.agentSet;
}

function emitAgentSetExpression(
  expression: PetsAgentSetExpression,
  context: ExpressionContext,
): string {
  if (expression.kind === "where") {
    const root = emitAgentSetExpression(expression.source, context);
    const agentSet = inferAgentSetFromExpression(expression, context);
    const outerAgent = context.agent;
    const itemAgent = outerAgent ? "candidate" : "agent";
    if (expression.state) {
      return `${root}.filter((${itemAgent}) => ${emitStatePredicate(expression.state, { ...context, agent: itemAgent, agentSet, selfAgent: outerAgent })})`;
    } else {
      return `${root}.filter((${itemAgent}) => ${lowerExpression(expression.condition, { ...context, agent: itemAgent, agentSet, selfAgent: outerAgent, statePredicate: true })})`;
    }
  }

  if (expression.kind === "here") {
    if (!context.agent) {
      throw new Error("here requires a current agent.");
    }
    const innerSet = emitAgentSetExpression(expression.source, context);
    return `${innerSet}.filter((candidate) => samePatch(candidate, ${context.agent}))`;
  }

  if (expression.kind === "named") {
    const agentSet = expression.name;
    if (context.queryLocals?.has(agentSet)) {
      return toJsIdentifier(agentSet);
    }
    if (
      isPatchLikeAgentSet(agentSet, context) ||
      isZoneAgentSet(agentSet, context) ||
      isPetAgentSet(agentSet, context) ||
      isLinkAgentSet(agentSet, context)
    ) {
      return emitAgentSet(agentSet, undefined, context);
    }
    throw new Error(`Unknown agentset "${agentSet}".`);
  }

  if (expression.kind === "other") {
    if (!context.agent) {
      throw new Error("other requires a current agent.");
    }
    return `${emitAgentSetExpression(expression.source, context)}.other(${context.agent})`;
  }

  if (expression.kind === "link-neighbors") {
    if (!context.agent) {
      throw new Error("link-neighbors is only available inside a pet update.");
    }
    const breed = expression.breed ? `, ${emitLinkBreedReference(expression.breed, context)}` : "";
    return `m.linkNeighbors(${context.agent}${breed})`;
  }

  if (expression.kind === "links-with") {
    if (!context.agent) {
      throw new Error("links-with is only available inside a pet update.");
    }
    const breed = expression.breed ? `, ${emitLinkBreedReference(expression.breed, context)}` : "";
    return `m.linksOf(${context.agent}${breed})`;
  }

  if (expression.kind === "in-link-neighbors") {
    if (!context.agent) {
      throw new Error("in-link-neighbors is only available inside a pet update.");
    }
    const breed = expression.breed ? `, ${emitLinkBreedReference(expression.breed, context)}` : "";
    return `m.inLinkNeighbors(${context.agent}${breed})`;
  }

  if (expression.kind === "out-link-neighbors") {
    if (!context.agent) {
      throw new Error("out-link-neighbors is only available inside a pet update.");
    }
    const breed = expression.breed ? `, ${emitLinkBreedReference(expression.breed, context)}` : "";
    return `m.outLinkNeighbors(${context.agent}${breed})`;
  }

  if (expression.kind === "in-links") {
    if (!context.agent) {
      throw new Error("in-links is only available inside a pet update.");
    }
    const breed = expression.breed ? `, ${emitLinkBreedReference(expression.breed, context)}` : "";
    return `m.linksInto(${context.agent}${breed})`;
  }

  if (expression.kind === "out-links") {
    if (!context.agent) {
      throw new Error("out-links is only available inside a pet update.");
    }
    const breed = expression.breed ? `, ${emitLinkBreedReference(expression.breed, context)}` : "";
    return `m.linksOutOf(${context.agent}${breed})`;
  }

  if (expression.kind === "n-of") {
    return `arrayQuery(${emitAgentSetExpression(expression.source, context)}.nOf(${lowerExpression(expression.count, context)}))`;
  }

  throw new Error(`Unsupported agentset expression ${(expression as { kind: string }).kind}.`);
}

function emitLinkBreedReference(source: string, context: ExpressionContext) {
  const trimmed = source.trim();
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed) && context.linkBreedNames.has(trimmed)) {
    return toJsIdentifier(trimmed);
  }

  throw new Error(`Expected a link breed, received "${trimmed}".`);
}

function emitPetBreedReference(source: string, context: ExpressionContext) {
  const trimmed = source.trim();
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed) && context.breedNames.has(trimmed)) {
    return toJsIdentifier(trimmed);
  }

  throw new Error(`Expected a pet breed, received "${trimmed}".`);
}

function isKnownAgentSetExpression(
  expression: PetsAgentSetExpression,
  context: ExpressionContext,
): boolean {
  if (expression.kind === "named") {
    const agentSet = expression.name;
    return Boolean(
      context.queryLocals?.has(agentSet) ||
      isPatchLikeAgentSet(agentSet, context) ||
      isZoneAgentSet(agentSet, context) ||
      isPetAgentSet(agentSet, context) ||
      isLinkAgentSet(agentSet, context),
    );
  }

  if (expression.kind === "other" || expression.kind === "n-of" || expression.kind === "here" || expression.kind === "where") {
    return isKnownAgentSetExpression(expression.source, context);
  }

  return true;
}

interface SpatialWhereClause {
  condition?: string;
  state?: string;
}

interface AroundClause {
  xSource: string;
  ySource: string;
}

interface AroundQueryParts {
  agentSet: string;
  where?: SpatialWhereClause;
  around: AroundClause;
  endIndex: number;
}

interface DirectedPatchNeighborQueryParts {
  argsSource: string;
  where?: SpatialWhereClause;
  endIndex: number;
}

function replaceDirectedPatchNeighborCountAnyExpressions(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  const matcher = /\b(count|any)\s+neighbou?rs-at\s*\(/g;
  let cursor = 0;
  let output = "";

  while (true) {
    matcher.lastIndex = cursor;
    const match = matcher.exec(source);

    if (!match) {
      break;
    }

    const openIndex = source.indexOf("(", match.index);
    const closeIndex = findMatchingParen(source, openIndex);
    if (closeIndex < 0) {
      output += source.slice(cursor, matcher.lastIndex);
      cursor = matcher.lastIndex;
      continue;
    }

    const where = readOptionalWhereClause(source, closeIndex + 1);
    if (where === null) {
      throw new Error(`${match[0].trim()} uses an invalid where clause.`);
    }

    const query = emitDirectedPatchNeighborQueryWithWhere(
      source.slice(openIndex + 1, closeIndex),
      where.where,
      context,
    );
    const count = `${query}.count()`;

    output += source.slice(cursor, match.index);
    output += protect(match[1] === "any" ? `${count} > 0` : count);
    cursor = where.endIndex;
  }

  return output + source.slice(cursor);
}

function readDirectedPatchNeighborQueryParts(
  source: string,
  startIndex: number,
): DirectedPatchNeighborQueryParts | null {
  const start = skipSpaces(source, startIndex);
  const match = /^neighbou?rs-at\s*\(/.exec(source.slice(start));

  if (!match) {
    return null;
  }

  const openIndex = start + match[0].length - 1;
  const closeIndex = findMatchingParen(source, openIndex);
  if (closeIndex < 0) {
    return null;
  }

  const where = readOptionalWhereClause(source, closeIndex + 1);
  if (where === null) {
    return null;
  }

  return {
    argsSource: source.slice(openIndex + 1, closeIndex),
    where: where.where,
    endIndex: where.endIndex,
  };
}

function emitDirectedPatchNeighborQueryWithWhere(
  argsSource: string,
  where: SpatialWhereClause | undefined,
  context: ExpressionContext,
) {
  const agent = context.agent ?? "agent";
  const directions = parsePatchNeighborDirections(argsSource, "neighbors-at");
  const query = `${agent}.neighborsAt(${
    directions.map((direction) => JSON.stringify(direction)).join(", ")
  })`;

  if (where?.condition) {
    return `${query}.filter((neighbor) => ${lowerExpression(where.condition, {
      ...context,
      agent: "neighbor",
      statePredicate: true,
    })})`;
  }

  if (where?.state) {
    return `${query}.filter((neighbor) => ${emitStatePredicate(where.state, { ...context, agent: "neighbor" })})`;
  }

  return query;
}

function replacePatchNeighborCountAnyExpressions(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  const matcher = /\b(count|any)\s+(neighbors4|neighbors8)\b/g;
  let cursor = 0;
  let output = "";

  while (true) {
    matcher.lastIndex = cursor;
    const match = matcher.exec(source);

    if (!match) {
      break;
    }

    output += source.slice(cursor, match.index);
    output += protect(emitPatchNeighborCountAnyReporter(
      match[1] as "count" | "any",
      match[2] as "neighbors4" | "neighbors8",
      source,
      matcher.lastIndex,
      context,
    ));
    cursor = patchNeighborExpressionEnd(source, matcher.lastIndex);
  }

  return output + source.slice(cursor);
}

function emitPatchNeighborCountAnyReporter(
  reporter: "count" | "any",
  neighborSet: "neighbors4" | "neighbors8",
  source: string,
  startIndex: number,
  context: ExpressionContext,
) {
  const agent = context.agent ?? "agent";
  const where = readOptionalWhereClause(source, startIndex);

  if (where === null) {
    return `${agent}.${neighborSet}().count()`;
  }

  const query = emitPatchNeighborQueryWithWhere(agent, neighborSet, where.where, context);
  const count = `${query}.count()`;
  return reporter === "any" ? `${count} > 0` : count;
}

function emitPatchNeighborQueryWithWhere(
  agent: string,
  neighborSet: "neighbors4" | "neighbors8",
  where: SpatialWhereClause | undefined,
  context: ExpressionContext,
) {
  if (where?.condition) {
    return `${agent}.${neighborSet}((neighbor) => ${lowerExpression(where.condition, { ...context, agent: "neighbor", statePredicate: true })})`;
  }

  if (where?.state) {
    return `${agent}.${neighborSet}((neighbor) => ${emitStatePredicate(where.state, { ...context, agent: "neighbor" })})`;
  }

  return `${agent}.${neighborSet}()`;
}

function patchNeighborExpressionEnd(source: string, startIndex: number) {
  const where = readOptionalWhereClause(source, startIndex);
  return where?.endIndex ?? startIndex;
}

function replaceAroundCountExpressions(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  const matcher = /\b(count|any)\s+(patches|pets|pets|turtles|links|[A-Za-z][A-Za-z0-9_-]*)\b/g;
  let cursor = 0;
  let output = "";

  while (true) {
    matcher.lastIndex = cursor;
    const match = matcher.exec(source);

    if (!match) {
      break;
    }

    const reporter = match[1];
    const agentSet = match[2];
    const query = readAroundQueryTail(source, matcher.lastIndex);

    if (!query || !isAroundAgentSet(agentSet, context)) {
      output += source.slice(cursor, matcher.lastIndex);
      cursor = matcher.lastIndex;
      continue;
    }

    output += source.slice(cursor, match.index);
    const countExpr = `${emitAroundQueryWithWhere(agentSet, query.where, query.around, context)}.count()`;
    output += protect(reporter === "any" ? `(${countExpr} > 0)` : countExpr);
    cursor = query.endIndex;
  }

  return output + source.slice(cursor);
}

function replaceAroundAggregateExpressions(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  const matcher = /\b(sum|mean|min|max)\s+(patches|pets|pets|turtles|links|[A-Za-z][A-Za-z0-9_-]*)\b/g;
  let cursor = 0;
  let output = "";

  while (true) {
    matcher.lastIndex = cursor;
    const match = matcher.exec(source);

    if (!match) {
      break;
    }

    const aggregate = match[1] as "sum" | "mean" | "min" | "max";
    const agentSet = match[2];
    const query = readAroundQueryTail(source, matcher.lastIndex);

    if (!query || !isAroundAgentSet(agentSet, context)) {
      output += source.slice(cursor, matcher.lastIndex);
      cursor = matcher.lastIndex;
      continue;
    }

    const reportIndex = readKeyword(source, query.endIndex, "report");
    if (reportIndex === null) {
      output += source.slice(cursor, matcher.lastIndex);
      cursor = matcher.lastIndex;
      continue;
    }

    const expressionStart = skipSpaces(source, reportIndex);
    if (source[expressionStart] !== "(") {
      output += source.slice(cursor, matcher.lastIndex);
      cursor = matcher.lastIndex;
      continue;
    }

    const expressionEnd = findMatchingParen(source, expressionStart);
    if (expressionEnd < 0) {
      output += source.slice(cursor, matcher.lastIndex);
      cursor = matcher.lastIndex;
      continue;
    }

    output += source.slice(cursor, match.index);
    output += protect(emitAroundAggregateReporter(
      aggregate,
      agentSet,
      query.where,
      query.around,
      source.slice(expressionStart + 1, expressionEnd),
      context,
    ));
    cursor = expressionEnd + 1;
  }

  return output + source.slice(cursor);
}

function readAroundQueryParts(
  source: string,
  startIndex: number,
  context: ExpressionContext,
): AroundQueryParts | null {
  const start = skipSpaces(source, startIndex);
  const match = /^(patches|pets|pets|turtles|links|[A-Za-z][A-Za-z0-9_-]*)\b/.exec(source.slice(start));

  if (!match || !isAroundAgentSet(match[1], context)) {
    return null;
  }

  const query = readAroundQueryTail(source, start + match[0].length);

  if (!query) {
    return null;
  }

  return {
    agentSet: match[1],
    ...query,
  };
}

function readAroundQueryTail(
  source: string,
  startIndex: number,
): { where?: SpatialWhereClause; around: AroundClause; endIndex: number } | null {
  const where = readOptionalWhereClause(source, startIndex);

  if (where === null) {
    return null;
  }

  const around = readAroundClause(source, where.endIndex);

  if (!around) {
    return null;
  }

  return {
    where: where.where,
    around: around.around,
    endIndex: around.endIndex,
  };
}

function readOptionalWhereClause(source: string, startIndex: number): { where?: SpatialWhereClause; endIndex: number } | null {
  const whereMatch = /^\s+where\b/.exec(source.slice(startIndex));

  if (!whereMatch) {
    return { endIndex: startIndex };
  }

  const whereBodyStart = skipSpaces(source, startIndex + whereMatch[0].length);

  if (source[whereBodyStart] === "(") {
    const whereBodyEnd = findMatchingParen(source, whereBodyStart);

    if (whereBodyEnd < 0) {
      return null;
    }

    return {
      where: { condition: source.slice(whereBodyStart + 1, whereBodyEnd) },
      endIndex: whereBodyEnd + 1,
    };
  }

  const stateMatch = /^[A-Za-z][A-Za-z0-9_-]*/.exec(source.slice(whereBodyStart));

  if (!stateMatch) {
    return null;
  }

  return {
    where: { state: stateMatch[0] },
    endIndex: whereBodyStart + stateMatch[0].length,
  };
}

function readAroundClause(source: string, startIndex: number): { around: AroundClause; endIndex: number } | null {
  const aroundMatch = /^\s+around\b/.exec(source.slice(startIndex));

  if (!aroundMatch) {
    return null;
  }

  const openIndex = skipSpaces(source, startIndex + aroundMatch[0].length);
  if (source[openIndex] !== "(") {
    return null;
  }

  const closeIndex = findMatchingParen(source, openIndex);
  if (closeIndex < 0) {
    return null;
  }

  const coordinates = splitTopLevelCommas(source.slice(openIndex + 1, closeIndex));
  if (coordinates.length !== 2) {
    throw new Error("around clauses use around (x, y).");
  }

  return {
    around: {
      xSource: coordinates[0],
      ySource: coordinates[1],
    },
    endIndex: closeIndex + 1,
  };
}

function readKeyword(source: string, startIndex: number, keyword: string) {
  const match = new RegExp(`^\\s+${keyword}\\b`).exec(source.slice(startIndex));
  return match ? startIndex + match[0].length : null;
}

function skipSpaces(source: string, startIndex: number) {
  let cursor = startIndex;

  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function emitAroundAggregateReporter(
  aggregate: "sum" | "mean" | "min" | "max",
  agentSet: string,
  where: SpatialWhereClause | undefined,
  around: AroundClause,
  expressionSource: string,
  context: ExpressionContext,
) {
  const query = emitAroundQueryWithWhere(agentSet, where, around, context);
  const valueExpression = lowerExpression(expressionSource, {
    ...context,
    agent: "candidate",
    agentSet,
    selfAgent: context.agent,
  });
  const valuesExpression = `${query}.map((candidate) => Number(${valueExpression}))`;
  const sumExpression = `${valuesExpression}.reduce((total, value) => total + value, 0)`;

  if (aggregate === "sum") {
    return sumExpression;
  }

  if (aggregate === "mean") {
    return `(() => { const values = ${valuesExpression}; return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length; })()`;
  }

  if (aggregate === "min") {
    return `(() => { const values = ${valuesExpression}; return values.length === 0 ? 0 : Math.min(...values); })()`;
  }

  return `(() => { const values = ${valuesExpression}; return values.length === 0 ? 0 : Math.max(...values); })()`;
}

function emitAroundQueryWithWhere(
  agentSet: string,
  where: SpatialWhereClause | undefined,
  around: AroundClause,
  context: ExpressionContext,
) {
  const query = emitAroundBaseQuery(agentSet, around, context);

  if (where?.condition) {
    return `${query}.filter((candidate) => ${lowerExpression(where.condition, {
      ...context,
      agent: "candidate",
      agentSet,
      selfAgent: context.agent,
      statePredicate: true,
    })})`;
  }

  if (where?.state) {
    return `${query}.filter((candidate) => ${emitStatePredicate(where.state, {
      ...context,
      agent: "candidate",
      agentSet,
      selfAgent: context.agent,
    })})`;
  }

  return query;
}

function emitAroundBaseQuery(
  agentSet: string,
  around: AroundClause,
  context: ExpressionContext,
) {
  const x = lowerExpression(around.xSource, context);
  const y = lowerExpression(around.ySource, context);

  if (context.queryLocals?.has(agentSet)) {
    return `aroundQuery(${toJsIdentifier(agentSet)}, ${x}, ${y})`;
  }

  if (agentSet === "patches") {
    return `aroundPatchQuery(${x}, ${y})`;
  }

  if (context.breedNames.has(agentSet)) {
    return `aroundPetQuery(${toJsIdentifier(agentSet)}, ${x}, ${y})`;
  }

  return `aroundQuery(${emitAgentSet(agentSet, undefined, context)}, ${x}, ${y})`;
}

function isAroundAgentSet(agentSet: string, context: ExpressionContext) {
  return isPatchLikeAgentSet(agentSet, context) ||
    isZoneAgentSet(agentSet, context) ||
    isPetAgentSet(agentSet, context) ||
    isLinkAgentSet(agentSet, context) ||
    Boolean(context.queryLocals?.has(agentSet));
}

function replacePatchRegionPredicateCalls(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /\bpatch-(in-radius|in-square)\s*\((.*)\)/g,
    (_match, shape: "in-radius" | "in-square", argsSource: string) => {
      const args = splitTopLevelCommas(argsSource);
      if (args.length !== 3 && args.length !== 1) {
        throw new Error(`patch-${shape} requires radius, and optionally x and y.`);
      }

      const agent = context.agent ?? "agent";
      const helper = shape === "in-radius" ? "patchInRadius" : "patchInSquare";

      if (args.length === 1) {
        if (!context.agent) {
          throw new Error("An explicit center is needed outside agent context.");
        }
        let cx: string;
        let cy: string;
        if (isPetAgentSet(context.agentSet, context) || isZoneAgentSet(context.agentSet, context)) {
          cx = `${context.agent}.x`;
          cy = `${context.agent}.y`;
        } else if (isPatchLikeAgentSet(context.agentSet, context)) {
          cx = `${context.agent}.px`;
          cy = `${context.agent}.py`;
        } else {
          throw new Error("An explicit center is needed outside agent context.");
        }
        return protect(`${helper}(${agent}, ${lowerExpression(args[0], context)}, ${cx}, ${cy})`);
      }

      return protect(`${helper}(${agent}, ${lowerExpression(args[0], context)}, ${lowerExpression(args[1], context)}, ${lowerExpression(args[2], context)})`);
    },
  );
}
function findExpressionStartBackwards(source: string, endIndex: number): number {
  let depth = 0;
  let cursor = endIndex;
  while (cursor >= 0 && /\s/.test(source[cursor])) {
    cursor -= 1;
  }
  while (cursor >= 0) {
    const char = source[cursor];
    if (char === ")") {
      depth += 1;
    } else if (char === "(") {
      depth -= 1;
    } else if (depth === 0) {
      if (/[=,([+\-*/%<>]|<-|:=|:/.test(char)) {
        break;
      }
      if (cursor >= 3 && /\b(let|if|then|else|where|match|report)\s*$/.test(source.slice(0, cursor + 1))) {
        break;
      }
    }
    if (depth < 0) {
      break;
    }
    cursor -= 1;
  }
  return cursor + 1;
}

function readRandomSubsetQueryTail(
  source: string,
  startIndex: number,
  context: ExpressionContext,
): { agentSet: string; other: boolean; where?: SpatialWhereClause; endIndex: number } | null {
  let cursor = skipSpaces(source, startIndex);
  let other = false;
  
  if (source.slice(cursor).startsWith("other")) {
    const afterOther = cursor + 5;
    if (afterOther < source.length && /\s/.test(source[afterOther])) {
      other = true;
      cursor = skipSpaces(source, afterOther);
    }
  }
  
  const agentSetMatch = /^(link-neighbors|links-with|in-link-neighbors|out-link-neighbors|in-links|out-links|patches|pets|turtles|links|[A-Za-z][A-Za-z0-9_-]*)\b/.exec(source.slice(cursor));
  if (!agentSetMatch) {
    return null;
  }
  
  let agentSet = agentSetMatch[1];
  let endIndex = cursor + agentSetMatch[0].length;
  
  if (source[endIndex] === "(") {
    const closeParen = findMatchingParen(source, endIndex);
    if (closeParen >= 0) {
      agentSet = source.slice(cursor, closeParen + 1);
      endIndex = closeParen + 1;
    }
  }
  
  const where = readOptionalWhereClause(source, endIndex);
  if (where) {
    return {
      agentSet,
      other,
      where: where.where,
      endIndex: where.endIndex,
    };
  }
  
  return {
    agentSet,
    other,
    endIndex,
  };
}

function emitRandomSubsetQuery(
  countExpr: string,
  agentSet: string,
  other: boolean,
  where: SpatialWhereClause | undefined,
  context: ExpressionContext,
): string {
  let baseQuery: string;
  
  const parsedAgentSet = parseAgentSetExpression(agentSet);
  if (parsedAgentSet && isKnownAgentSetExpression(parsedAgentSet, context)) {
    baseQuery = emitAgentSetExpression(parsedAgentSet, context);
  } else {
    if (context.queryLocals?.has(agentSet)) {
      baseQuery = toJsIdentifier(agentSet);
    } else if (
      isPatchLikeAgentSet(agentSet, context) ||
      isZoneAgentSet(agentSet, context) ||
      isPetAgentSet(agentSet, context) ||
      isLinkAgentSet(agentSet, context)
    ) {
      baseQuery = emitAgentSet(agentSet, undefined, context);
    } else {
      baseQuery = toJsIdentifier(agentSet);
    }
  }
  
  if (other) {
    if (!context.agent) {
      throw new Error("other requires a current agent.");
    }
    baseQuery = `${baseQuery}.other(${context.agent})`;
  }
  
  if (where) {
    const outerAgent = context.agent;
    const itemAgent = outerAgent ? "candidate" : "agent";
    
    if (where.condition) {
      baseQuery = `${baseQuery}.filter((${itemAgent}) => ${lowerExpression(where.condition, { ...context, agent: itemAgent, agentSet, selfAgent: outerAgent, statePredicate: true })})`;
    } else if (where.state) {
      baseQuery = `${baseQuery}.filter((${itemAgent}) => ${emitStatePredicate(where.state, { ...context, agent: itemAgent, agentSet, selfAgent: outerAgent })})`;
    }
  }
  
  const loweredCount = lowerExpression(countExpr, context);
  return `arrayQuery(${baseQuery}.nOf(${loweredCount}))`;
}

function replaceRandomSubsetQueries(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
): string {
  let output = "";
  let cursor = 0;
  
  while (cursor < source.length) {
    const match = /\s+random\s+/.exec(source.slice(cursor));
    if (!match) {
      break;
    }
    
    const randomStart = cursor + match.index;
    const randomEnd = randomStart + match[0].length;
    
    const exprStart = findExpressionStartBackwards(source.slice(0, randomStart), randomStart - 1);
    const countExpr = source.slice(exprStart, randomStart).trim();
    
    const queryTail = readRandomSubsetQueryTail(source, randomEnd, context);
    if (!queryTail) {
      output += source.slice(cursor, randomEnd);
      cursor = randomEnd;
      continue;
    }
    
    const replacement = emitRandomSubsetQuery(
      countExpr,
      queryTail.agentSet,
      queryTail.other,
      queryTail.where,
      context,
    );
    
    output += source.slice(cursor, exprStart);
    output += protect(replacement);
    cursor = queryTail.endIndex;
  }
  
  return output + source.slice(cursor);
}

function replaceRandomCalls(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return replaceFunctionCalls(
    source,
    /(?:random-float|random-int|random)/g,
    (name, argsSource) => {
      const args = splitTopLevelCommas(argsSource);
      if (args.length > 1) {
        throw new Error(`${name} requires zero or one argument.`);
      }

      const max = args[0] ? lowerExpression(args[0], context) : "1";
      const agent = context.agent ?? "undefined";
      const salt = nextRandomSalt(context);

      if (name === "random-float") {
        return protect(`m.randomFloatFor(${agent}, ${salt}, ${max})`);
      }

      return protect(`m.randomIntFor(${agent}, ${salt}, ${max})`);
    },
  );
}

function replaceFunctionCalls(
  source: string,
  namePattern: RegExp,
  replace: (name: string, argsSource: string) => string,
) {
  const matcher = new RegExp(`\\b(${namePattern.source})\\s*\\(`, "g");
  let cursor = 0;
  let output = "";

  while (true) {
    matcher.lastIndex = cursor;
    const match = matcher.exec(source);
    if (!match) {
      break;
    }

    const openIndex = source.indexOf("(", match.index);
    const closeIndex = findMatchingParen(source, openIndex);
    if (closeIndex < 0) {
      break;
    }

    output += source.slice(cursor, match.index);
    output += replace(match[1], source.slice(openIndex + 1, closeIndex));
    cursor = closeIndex + 1;
  }

  return output + source.slice(cursor);
}

function lowerIfExpression(source: string, context: ExpressionContext) {
  const trimmed = source.trim();
  if (!trimmed.startsWith("if")) {
    return null;
  }

  const open = trimmed.indexOf("(");
  if (open < 0 || trimmed.slice(0, open).trim() !== "if") {
    return null;
  }

  const close = findMatchingParen(trimmed, open);
  if (close < 0) {
    return null;
  }

  const afterCondition = trimmed.slice(close + 1).trimStart();
  if (!afterCondition.startsWith("then ")) {
    return null;
  }

  const branches = afterCondition.slice("then ".length);
  const elseIndex = findTopLevelKeyword(branches, "else");
  if (elseIndex < 0) {
    return null;
  }

  const condition = trimmed.slice(open + 1, close);
  const consequent = branches.slice(0, elseIndex).trim();
  const alternate = branches.slice(elseIndex + "else".length).trim();

  return `((${lowerExpression(condition, { ...context, statePredicate: true })}) ? ${lowerExpression(consequent, { ...context, statePredicate: false })} : ${lowerExpression(alternate, { ...context, statePredicate: false })})`;
}

function findMatchingParen(source: string, openIndex: number) {
  let depth = 0;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findTopLevelKeyword(source: string, keyword: string) {
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (
      depth === 0 &&
      source.slice(index, index + keyword.length) === keyword &&
      isKeywordBoundary(source[index - 1]) &&
      isKeywordBoundary(source[index + keyword.length])
    ) {
      return index;
    }
  }

  return -1;
}

function isKeywordBoundary(character: string | undefined) {
  return character === undefined || !/[A-Za-z0-9_-]/.test(character);
}

function replaceMembershipExpressions(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
  restoreProtected: (code: string) => string,
) {
  return source.replace(
    /(§\d+§|[A-Za-z][A-Za-z0-9_.-]*|-?\d+(?:\.\d+)?)\s+in\s+\[([^\]]*)\]/g,
    (_match, candidate: string, setSource: string) => {
      const value = candidate.startsWith("§")
        ? restoreProtected(candidate)
        : lowerExpression(candidate, { ...context, statePredicate: false });

      return protect(`${emitSetLiteral(setSource, context)}.includes(${value})`);
    },
  );
}

function emitSetLiteral(source: string, context: ExpressionContext) {
  const values = splitTopLevelCommas(source)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => lowerExpression(value, { ...context, statePredicate: false }));

  return `[${values.join(", ")}]`;
}

function resolveIdentifier(identifier: string, context: ExpressionContext) {
  if (identifier === "self") {
    if (!context.agent) {
      throw new Error("self is not valid in observer contexts.");
    }
    return context.agent;
  }

  if (identifier === "mine") {
    if (!context.selfAgent) {
      throw new Error("mine is only available inside nested queries.");
    }
    return context.selfAgent;
  }

  if (identifier === "nobody") {
    return "undefined";
  }

  if (identifier === "true" || identifier === "false") {
    return identifier;
  }

  if (context.locals?.has(identifier)) {
    return toJsIdentifier(identifier);
  }

  if (identifier === "random-float") {
    return "m.randomFloat";
  }

  if (identifier === "random-int") {
    return "m.randomInt";
  }

  if (identifier === "random") {
    return "m.random";
  }

  if (identifier === "floor") {
    return "Math.floor";
  }

  if (identifier === "ceil") {
    return "Math.ceil";
  }

  if (identifier === "round") {
    return "Math.round";
  }

  if (identifier === "abs") {
    return "Math.abs";
  }

  if (identifier === "min") {
    return "Math.min";
  }

  if (identifier === "max") {
    return "Math.max";
  }

  if (identifier === "sqrt") {
    return "Math.sqrt";
  }

  if (identifier === "pow") {
    return "Math.pow";
  }

  if (identifier === "sin") {
    return "Math.sin";
  }

  if (identifier === "cos") {
    return "Math.cos";
  }

  if (identifier === "tan") {
    return "Math.tan";
  }

  if (identifier === "min-x") {
    return "world.config.minX";
  }

  if (identifier === "max-x") {
    return "world.config.maxX";
  }

  if (identifier === "min-y") {
    return "world.config.minY";
  }

  if (identifier === "max-y") {
    return "world.config.maxY";
  }

  if (identifier === "tick") {
    return "world.ticks";
  }

  if (context.defs.has(identifier)) {
    return toJsIdentifier(identifier);
  }

  if (context.breedNames.has(identifier)) {
    return toJsIdentifier(identifier);
  }

  if (context.linkBreedNames.has(identifier)) {
    return toJsIdentifier(identifier);
  }

  if (context.zoneNames.has(identifier)) {
    return toJsIdentifier(identifier);
  }

  if (context.agent && isPatchLikeAgentSet(context.agentSet, context) && context.patchFields.has(identifier)) {
    return `${context.agent}.${toJsIdentifier(identifier)}`;
  }

  if (context.agent && isPatchLikeAgentSet(context.agentSet, context) && (identifier === "px" || identifier === "py")) {
    return `${context.agent}.${identifier}`;
  }

  if (context.agent && isZoneAgentSet(context.agentSet, context) && context.zoneFields.has(identifier)) {
    return `${context.agent}.${toJsIdentifier(identifier)}`;
  }

  if (context.agent && isPetAgentSet(context.agentSet, context) && context.petFields.has(identifier)) {
    return `${context.agent}.${toJsIdentifier(identifier)}`;
  }

  if (context.agent && isLinkAgentSet(context.agentSet, context) && context.linkFields.has(identifier)) {
    return `${context.agent}.${toJsIdentifier(identifier)}`;
  }

  const memoryType = context.memoryFields.get(identifier);
  if (memoryType) {
    return toJsIdentifier(identifier);
  }

  const paramType = context.params.get(identifier);
  if (paramType?.kind === "number") {
    return `Number(m.${toJsIdentifier(identifier)})`;
  }

  if (paramType?.kind === "boolean" || paramType?.kind === "enum" || paramType?.kind === "string") {
    return `m.${toJsIdentifier(identifier)}`;
  }

  if (context.enumValues.has(identifier)) {
    return JSON.stringify(identifier);
  }

  return toJsIdentifier(identifier);
}

function protectBareStatePredicates(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /\b[A-Za-z][A-Za-z0-9_-]*\b/g,
    (identifier, offset: number) => {
      if (!context.stateValues.has(identifier)) {
        return identifier;
      }

      if (isComparisonOperand(source, offset, identifier.length)) {
        return identifier;
      }

      return protect(emitStatePredicate(identifier, context));
    },
  );
}

function isComparisonOperand(source: string, start: number, length: number) {
  const previous = previousNonSpace(source, start - 1);
  const next = nextNonSpace(source, start + length);
  return previous === "=" || previous === "!" || previous === "<" || previous === ">" ||
    next === "=" || next === "!" || next === "<" || next === ">";
}

function previousNonSpace(source: string, index: number) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (!/\s/.test(source[cursor])) {
      return source[cursor];
    }
  }

  return undefined;
}

function nextNonSpace(source: string, index: number) {
  for (let cursor = index; cursor < source.length; cursor += 1) {
    if (!/\s/.test(source[cursor])) {
      return source[cursor];
    }
  }

  return undefined;
}

function emitStatePredicate(state: string, context: ExpressionContext) {
  const agent = context.agent ?? "agent";
  const booleanFields = booleanFieldsForAgentSet(context);
  if (booleanFields.has(state)) {
    return `${agent}.${toJsIdentifier(state)}`;
  }
  return `${agent}.state === ${JSON.stringify(state)}`;
}

function booleanFieldsForAgentSet(context: ExpressionContext): Set<string> {
  if (isPetAgentSet(context.agentSet, context)) {
    return context.petBooleanFields;
  }
  if (isLinkAgentSet(context.agentSet, context)) {
    return context.linkBooleanFields;
  }
  if (isZoneAgentSet(context.agentSet, context)) {
    return context.zoneBooleanFields;
  }
  // Default to patches when agentSet is undefined or "patches"/"patches-in".
  return context.patchBooleanFields;
}

function isPatchAgentSet(agentSet: string | undefined) {
  return agentSet === undefined || agentSet === "patches";
}

function isPatchLikeAgentSet(agentSet: string | undefined, context: ExpressionContext) {
  return isPatchAgentSet(agentSet) || isPatchesInAgentSet(agentSet, context);
}

function isPatchesInAgentSet(agentSet: string | undefined, context: ExpressionContext) {
  return agentSet === "patches-in" &&
    Boolean(context.agent) &&
    (context.agentSet === "patches-in" || isZoneAgentSet(context.agentSet, context));
}

function isZoneAgentSet(agentSet: string | undefined, context: EmitContext) {
  return agentSet !== undefined && context.zoneNames.has(agentSet);
}

function isPetAgentSet(agentSet: string | undefined, context: EmitContext) {
  return agentSet === "pets" ||
    agentSet === "pets" ||
    agentSet === "turtles" ||
    (agentSet !== undefined && context.breedNames.has(agentSet));
}

function isLinkAgentSet(agentSet: string | undefined, context: EmitContext) {
  return agentSet === "links" ||
    (agentSet !== undefined && context.linkBreedNames.has(agentSet));
}

function emitWritableFieldAccess(target: string, context: ExpressionContext) {
  if (target.includes("patch-here")) {
    throw new Error("`patch-here()` was renamed — use the `patch` property (e.g. `patch.has-grass`).");
  }

  const patchProperty = target.match(/^patch\.([A-Za-z][A-Za-z0-9_-]*)$/);
  if (patchProperty) {
    if (!context.agent) {
      throw new Error("`patch` is only available inside a pet update.");
    }

    return `${context.agent}.patchHere().${toJsIdentifier(patchProperty[1])}`;
  }

  if (/^patch$/.test(target.trim())) {
    throw new Error("`patch` is not assignable on its own. Use `patch.field := value` or `patch := :` with an indented field map.");
  }

  const patchAt = target.match(/^patch-at\s*\((.*)\)\.([A-Za-z][A-Za-z0-9_-]*)$/);
  if (patchAt) {
    const args = splitTopLevelCommas(patchAt[1]);
    if (args.length !== 2) {
      throw new Error("patch-at requires x and y arguments.");
    }

    return `m.patchAt(${lowerExpression(args[0], context)}, ${lowerExpression(args[1], context)}).${toJsIdentifier(patchAt[2])}`;
  }

  const localField = target.match(/^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)$/);
  if (localField && context.locals?.has(localField[1])) {
    return `${toJsIdentifier(localField[1])}.${toJsIdentifier(localField[2])}`;
  }

  return undefined;
}

function replaceSelfFieldCall(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  const replaceField = (_match: string, fieldName: string) => {
    if (!context.agent) {
      throw new Error("self is not valid in observer contexts.");
    }

    return protect(`${context.agent}.${toJsIdentifier(fieldName)}`);
  };

  return source.replace(
    /self\s*\(\s*([A-Za-z][A-Za-z0-9_-]*)\s*\)/g,
    replaceField,
  ).replace(/\bself\.([A-Za-z][A-Za-z0-9_-]*)/g, replaceField);
}

function replaceMineFieldCall(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  if (/\bmine\b/.test(source)) {
    const isShadowed = (context.agent !== undefined && context.agent !== "agent") || context.selfAgent !== undefined;
    if (!isShadowed) {
      if (context.agent === "agent" && !context.selfAgent) {
        throw new Error("mine is only available inside nested queries. In plain agent-block statements, plain identifiers already refer to the current agent.");
      } else {
        throw new Error("mine is only available inside nested queries.");
      }
    }
  }

  const replaceField = (_match: string, fieldName: string) => {
    let isValid = false;
    const asker = context.askerAgentSet;
    if (isPatchLikeAgentSet(asker, context)) {
      isValid = fieldName === "px" || fieldName === "py" || fieldName === "wall" || context.patchFields.has(fieldName);
    } else if (isPetAgentSet(asker, context)) {
      isValid = fieldName === "x" || fieldName === "y" || fieldName === "id" || fieldName === "heading" || fieldName === "px" || fieldName === "py" || context.petFields.has(fieldName);
    } else if (isZoneAgentSet(asker, context)) {
      isValid = context.zoneFields.has(fieldName);
    } else if (isLinkAgentSet(asker, context)) {
      isValid = context.linkFields.has(fieldName);
    }

    if (!isValid) {
      throw new Error(`Field "${fieldName}" is not readable on asking agent breed/patch.`);
    }

    if (isPetAgentSet(asker, context) && (fieldName === "px" || fieldName === "py")) {
      return protect(`agent.patchHere().${fieldName}`);
    }

    return protect(`agent.${toJsIdentifier(fieldName)}`);
  };

  let replaced = source.replace(/\bmine\.([A-Za-z][A-Za-z0-9_-]*)/g, replaceField);

  return replaced;
}

function replaceMovementReporterFieldAccess(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /(patch-ahead|patch-left-and-ahead|patch-right-and-ahead)\s*\(([^()]*)\)\.([A-Za-z][A-Za-z0-9_-]*)/g,
    (_match, reporter: string, argsSource: string, fieldName: string) => {
      const agent = context.agent ?? "agent";
      const args = splitTopLevelCommas(argsSource).map((arg) => lowerExpression(arg, context));

      if (reporter === "patch-ahead") {
        if (args.length !== 1) {
          throw new Error("patch-ahead requires distance.");
        }
        return protect(`checkLookup(${agent}.patchAhead(${args[0]}), \`patch-ahead(\${${args[0]}})\`, "check the lookup before reading .${fieldName}", "patch").${toJsIdentifier(fieldName)}`);
      }

      if (args.length !== 2) {
        throw new Error(`${reporter} requires angle and distance.`);
      }

      const method = reporter === "patch-left-and-ahead"
        ? "patchLeftAndAhead"
        : "patchRightAndAhead";
      return protect(`checkLookup(${agent}.${method}(${args[0]}, ${args[1]}), \`${reporter}(\${${args[0]}}, \${${args[1]}})\`, "check the lookup before reading .${fieldName}", "patch").${toJsIdentifier(fieldName)}`);
    },
  );
}

function replaceMovementReporterCall(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /\b(patch-ahead|patch-left-and-ahead|patch-right-and-ahead|can-move)\s*\(([^()]*)\)/g,
    (_match, reporter: string, argsSource: string) => {
      const agent = context.agent ?? "agent";
      const args = splitTopLevelCommas(argsSource).map((arg) => lowerExpression(arg, context));

      if (reporter === "patch-ahead") {
        if (args.length !== 1) {
          throw new Error("patch-ahead requires distance.");
        }
        return protect(`${agent}.patchAhead(${args[0]})`);
      }

      if (reporter === "can-move") {
        if (args.length !== 1) {
          throw new Error("can-move requires distance.");
        }
        return protect(`${agent}.canMove(${args[0]})`);
      }

      if (args.length !== 2) {
        throw new Error(`${reporter} requires angle and distance.`);
      }

      const method = reporter === "patch-left-and-ahead"
        ? "patchLeftAndAhead"
        : "patchRightAndAhead";
      return protect(`${agent}.${method}(${args[0]}, ${args[1]})`);
    },
  );
}

function replaceDirectedPatchNeighborFieldAccess(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /\b(neighbou?r-at)\s*\(([^()]*)\)\.([A-Za-z][A-Za-z0-9_-]*)/g,
    (_match, reporter: string, argsSource: string, fieldName: string) => {
      const agent = context.agent ?? "agent";
      const direction = parseSinglePatchNeighborDirection(argsSource, reporter);
      return protect(
        `checkLookup(${agent}.neighborAt(${JSON.stringify(direction)}), \`${reporter}(${direction})\`, "check the lookup before reading .${fieldName}", "patch").${toJsIdentifier(fieldName)}`,
      );
    },
  );
}

function replacePatchAtFieldAccess(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /patch-at\s*\(([^()]*)\)\.([A-Za-z][A-Za-z0-9_-]*)/g,
    (_match, argsSource: string, fieldName: string) => {
      const args = splitTopLevelCommas(argsSource);
      if (args.length !== 2) {
        throw new Error("patch-at requires x and y arguments.");
      }

      const x = lowerExpression(args[0], context);
      const y = lowerExpression(args[1], context);

      return protect(`checkLookup(m.patchAt(${x}, ${y}), \`patch-at(\${${x}}, \${${y}})\`, "check the lookup before reading .${fieldName}", "patch").${toJsIdentifier(fieldName)}`);
    },
  );
}

function replacePatchPropertyAccess(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /\bpatch\.([A-Za-z][A-Za-z0-9_-]*)/g,
    (_match, fieldName: string) => {
      const agent = context.agent ?? "agent";
      return protect(`${agent}.patchHere()?.${toJsIdentifier(fieldName)}`);
    },
  );
}

function replaceRefPropertyAccess(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /\b([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)\b/g,
    (match, obj: string, field: string) => {
      if (obj === "patch" || obj === "mine" || obj === "self") {
        return match;
      }

      let isRef = false;
      let refTo = "";

      if (context.localTypes && context.localTypes.has(obj)) {
        const type = context.localTypes.get(obj);
        if (type && type.kind === "ref") {
          isRef = true;
          refTo = type.to;
        }
      }

      if (!isRef && context.agentSet) {
        const breed = context.model.pets.find((b) => b.name === context.agentSet);
        if (breed) {
          const f = breed.fields.find((f) => f.name === obj);
          if (f && f.type.kind === "ref") {
            isRef = true;
            refTo = f.type.to;
          }
        }
        const link = context.model.links.find((b) => b.name === context.agentSet);
        if (link) {
          const f = link.fields.find((f) => f.name === obj);
          if (f && f.type.kind === "ref") {
            isRef = true;
            refTo = f.type.to;
          }
        }
      }

      if (!isRef) {
        const f = context.model.patches.find((f) => f.name === obj);
        if (f && f.type.kind === "ref") {
          isRef = true;
          refTo = f.type.to;
        }
      }

      if (isRef) {
        const resolvedObj = resolveIdentifier(obj, context);
        const suggestion = `check the reference before reading .${field}`;
        const typeLabel = refTo === "patch" ? "patch" : "pet";
        return protect(`checkLookup(${resolvedObj}, \`${obj}\`, "${suggestion}", "${typeLabel}").${toJsIdentifier(field)}`);
      }

      return match;
    }
  );
}

function replaceGenericCountAny(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  const matcher = /\b(count|any)\s+/g;
  let cursor = 0;
  let output = "";

  while (true) {
    matcher.lastIndex = cursor;
    const match = matcher.exec(source);
    if (!match) {
      break;
    }

    const reporter = match[1];
    const startIndex = matcher.lastIndex;

    let bestExpression: PetsAgentSetExpression | null = null;
    let bestEndIndex = -1;

    const rest = source.slice(startIndex);
    for (let len = 1; len <= rest.length; len++) {
      const candidate = rest.slice(0, len);
      
      let openParens = 0;
      for (const char of candidate) {
        if (char === '(') openParens++;
        else if (char === ')') openParens--;
      }
      if (openParens !== 0) continue;

      const parsed = parseAgentSetExpression(candidate);
      if (parsed && isKnownAgentSetExpression(parsed, context)) {
        bestExpression = parsed;
        bestEndIndex = startIndex + len;
      }
    }

    if (bestExpression) {
      output += source.slice(cursor, match.index);
      const emittedSet = emitAgentSetExpression(bestExpression, context);
      const countExpr = `${emittedSet}.count()`;
      const code = reporter === "any" ? `(${countExpr} > 0)` : countExpr;
      output += protect(code);
      cursor = bestEndIndex;
    } else {
      output += source.slice(cursor, matcher.lastIndex);
      cursor = matcher.lastIndex;
    }
  }

  return output + source.slice(cursor);
}

function replaceNearestInRadiusFieldAccess(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /nearest-in-radius\s*\(([^()]*)\)\.([A-Za-z][A-Za-z0-9_-]*)/g,
    (_match, argsSource: string, fieldName: string) => {
      const args = splitTopLevelCommas(argsSource);
      if (args.length !== 2) {
        throw new Error("nearest-in-radius requires breed and radius arguments.");
      }
      const agent = context.agent ?? "agent";
      const breed = lowerExpression(args[0], context);
      const radius = lowerExpression(args[1], context);
      return protect(
        `checkLookup(nearestInRadius(${agent}, ${breed}, ${radius}), \`nearest-in-radius(\${${breed}.name}, \${${radius}})\`, "check the lookup before reading .${fieldName}", "pet").${toJsIdentifier(fieldName)}`
      );
    },
  );
}

function replacePetAtFieldAccess(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /(?:pet-at|pet-at)\s*\(([^()]*)\)\.([A-Za-z][A-Za-z0-9_-]*)/g,
    (_match, argsSource: string, fieldName: string) => {
      const args = splitTopLevelCommas(argsSource);
      if (args.length !== 3) {
        throw new Error("pet-at requires breed, x, and y arguments.");
      }

      const breed = emitPetBreedReference(args[0], context);
      const x = lowerExpression(args[1], context);
      const y = lowerExpression(args[2], context);

      return protect(`checkLookup(petAt(${breed}, ${x}, ${y}), \`pet-at(\${${breed}.name}, \${${x}}, \${${y}})\`, "check the lookup before reading .${fieldName}", "pet").${toJsIdentifier(fieldName)}`);
    },
  );
}

function replaceDirectedPatchNeighborCall(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /\b(neighbou?r-at|neighbou?rs-at)\s*\(([^()]*)\)/g,
    (_match, reporter: string, argsSource: string) => {
      const agent = context.agent ?? "agent";

      if (reporter.endsWith("rs-at")) {
        const directions = parsePatchNeighborDirections(argsSource, reporter);
        return protect(
          `${agent}.neighborsAt(${
            directions.map((direction) => JSON.stringify(direction)).join(", ")
          })`,
        );
      }

      const direction = parseSinglePatchNeighborDirection(argsSource, reporter);
      return protect(`${agent}.neighborAt(${JSON.stringify(direction)})`);
    },
  );
}

function replacePatchAtCall(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /patch-at\s*\(([^()]*)\)/g,
    (_match, argsSource: string) => {
      const args = splitTopLevelCommas(argsSource);
      if (args.length !== 2) {
        throw new Error("patch-at requires x and y arguments.");
      }

      return protect(`m.patchAt(${lowerExpression(args[0], context)}, ${lowerExpression(args[1], context)})`);
    },
  );
}

function replacePetAtCall(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /(?:pet-at|pet-at)\s*\(([^()]*)\)/g,
    (_match, argsSource: string) => {
      const args = splitTopLevelCommas(argsSource);
      if (args.length !== 3) {
        throw new Error("pet-at requires breed, x, and y arguments.");
      }

      const breed = emitPetBreedReference(args[0], context);
      const x = lowerExpression(args[1], context);
      const y = lowerExpression(args[2], context);

      return protect(`petAt(${breed}, ${x}, ${y})`);
    },
  );
}

function replaceLinkEndpointFieldAccess(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  if (/\b(end1|end2)\s*\(\s*\)/.test(source)) {
    const match = source.match(/\b(end1|end2)\s*\(\s*\)/);
    const end = match ? match[1] : "end1";
    throw new Error(`\`${end}()\` was renamed — use \`${end}\` (e.g. \`${end}.color\`).`);
  }

  return source.replace(
    /\b(end1|end2)\.([A-Za-z][A-Za-z0-9_-]*)/g,
    (_match, endpoint: "end1" | "end2", fieldName: string) => {
      if (!context.agent || !isLinkAgentSet(context.agentSet, context)) {
        throw new Error(`${endpoint} is only available inside a link update.`);
      }
      return protect(`${context.agent}.${endpoint}()?.${toJsIdentifier(fieldName)}`);
    },
  );
}

function replaceLinkEndpointCall(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /\b(end1|end2)\b/g,
    (_match, endpoint: "end1" | "end2") => {
      if (!context.agent || !isLinkAgentSet(context.agentSet, context)) {
        throw new Error(`${endpoint} is only available inside a link update.`);
      }
      return protect(`${context.agent}.${endpoint}()`);
    },
  );
}

function replaceSpatialHelperCalls(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  let next = source;
  const agent = context.agent ?? "agent";

  next = next.replace(
    /\bsubtract-headings\s*\(([^()]*)\)/g,
    (_match, argsSource: string) => {
      const args = splitTopLevelCommas(argsSource);
      if (args.length !== 2) {
        throw new Error("subtract-headings requires two headings.");
      }
      return protect(`subtractHeadings(${lowerExpression(args[0], context)}, ${lowerExpression(args[1], context)})`);
    },
  );

  next = next.replace(
    /\b(count-here|any-here|nearest-distance-in-radius|nearest-in-radius|count-in-radius|average-heading-towards|average-heading)\s*\(([^()]*)\)/g,
    (_match, helper: string, argsSource: string) => {
      const args = splitTopLevelCommas(argsSource);

      if (helper === "count-here") {
        throw new Error("count-here was removed — write `count sheep here`.");
      }

      if (helper === "any-here") {
        if (args.length !== 1) {
          throw new Error(`${helper} requires a breed.`);
        }
        const breed = emitPetBreedReference(args[0], context);
        const count = `${breed}.all().filter((candidate) => samePatch(candidate, ${agent})).count()`;
        return protect(`${count} > 0`);
      }

      if ((helper === "average-heading" || helper === "average-heading-towards") && args.length === 1) {
        const candidates = lowerExpression(args[0], context);
        return protect(
          helper === "average-heading"
            ? `averageHeadingOf(${agent}, ${candidates})`
            : `averageHeadingTowards(${agent}, ${candidates})`,
        );
      }

      if (args.length !== 2) {
        throw new Error(`${helper} requires a breed and radius.`);
      }

      const breed = lowerExpression(args[0], context);
      const radius = lowerExpression(args[1], context);

      if (helper === "nearest-in-radius") {
        return protect(`nearestInRadius(${agent}, ${breed}, ${radius})`);
      }

      if (helper === "nearest-distance-in-radius") {
        return protect(`distanceToObject(${agent}, nearestInRadius(${agent}, ${breed}, ${radius}))`);
      }

      if (helper === "count-in-radius") {
        return protect(`countInRadius(${agent}, ${breed}, ${radius})`);
      }

      if (helper === "average-heading") {
        return protect(`averageHeadingInRadius(${agent}, ${breed}, ${radius})`);
      }

      return protect(`averageHeadingTowardsInRadius(${agent}, ${breed}, ${radius})`);
    },
  );

  next = next.replace(
    /(^|[^A-Za-z0-9_-])(distance-to|towards)\s*\(([^()]*)\)/g,
    (_match, prefix: string, helper: "distance-to" | "towards", targetSource: string) => {
      const target = lowerExpression(targetSource, context);
      return `${prefix}${protect(
        helper === "distance-to"
          ? `distanceToObject(${agent}, ${target})`
          : `headingToObject(${agent}, ${target})`,
      )}`;
    },
  );

  return next;
}

function emitZoneAtReporter(argsSource: string, context: ExpressionContext) {
  const args = splitTopLevelCommas(argsSource);

  if (args.length !== 1 && args.length !== 3) {
    throw new Error("zone-at requires a zone name, or a zone name plus x and y.");
  }

  const zones = lowerExpression(args[0], context);

  if (args.length === 1) {
    if (!context.agent) {
      throw new Error("zone-at(zone-name) is only available inside an agent update.");
    }

    return `zoneOf(${zones}, ${context.agent})`;
  }

  return `zoneAt(${zones}, ${lowerExpression(args[1], context)}, ${lowerExpression(args[2], context)})`;
}

function replaceZoneAtFieldAccess(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /zone-at\s*\(([^()]*)\)\.([A-Za-z][A-Za-z0-9_-]*)/g,
    (_match, argsSource: string, fieldName: string) =>
      protect(`${emitZoneAtReporter(argsSource, context)}?.${toJsIdentifier(fieldName)}`),
  );
}

function replaceZoneAtCall(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /zone-at\s*\(([^()]*)\)/g,
    (_match, argsSource: string) => protect(emitZoneAtReporter(argsSource, context)),
  );
}

function replaceNearestExpression(
  source: string,
  context: ExpressionContext,
  protect: (code: string) => string,
) {
  return source.replace(
    /nearest\s+(patches|pets|pets|turtles|[A-Za-z][A-Za-z0-9_-]*)(?:\s+where\s+(?:\(([^()]*)\)|([A-Za-z][A-Za-z0-9_-]*)))?/g,
    (_match, agentSet: string, condition: string | undefined, state: string | undefined) => {
      const origin = context.agent ?? "agent";
      if (context.queryLocals?.has(agentSet)) {
        const query = toJsIdentifier(agentSet);
        const filtered = condition
          ? `${query}.filter((candidate) => ${lowerExpression(condition, { ...context, agent: "candidate", statePredicate: true })})`
          : state
            ? `${query}.filter((candidate) => ${emitStatePredicate(state, { ...context, agent: "candidate" })})`
            : query;
        return protect(`nearestTo(${origin}, ${filtered})`);
      }

      const query = emitAgentSet(agentSet, undefined, context);
      const filtered = condition
        ? `${query}.filter((candidate) => ${lowerExpression(condition, { ...context, agent: "candidate", agentSet, statePredicate: true })})`
        : state
          ? `${query}.filter((candidate) => ${emitStatePredicate(state, { ...context, agent: "candidate", agentSet })})`
          : query;
      const candidates =
        isPetAgentSet(agentSet, context) && context.agent
          ? `${filtered}.other(${context.agent})`
          : filtered;

      return protect(`nearestTo(${origin}, ${candidates})`);
    },
  );
}

function parsePatchNeighborDirections(argsSource: string, reporter: string) {
  const directions = splitTopLevelCommas(argsSource);
  if (directions.length === 0) {
    throw new Error(`${reporter} requires at least one direction.`);
  }

  return directions.map((direction) => parsePatchNeighborDirection(direction, reporter));
}

function parseSinglePatchNeighborDirection(argsSource: string, reporter: string) {
  const directions = parsePatchNeighborDirections(argsSource, reporter);
  if (directions.length !== 1) {
    throw new Error(`${reporter} requires exactly one direction.`);
  }

  return directions[0];
}

function parsePatchNeighborDirection(source: string, reporter: string) {
  const direction = source.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(direction)) {
    throw new Error(`${reporter} directions are symbols like top-left, top, or bottom-right.`);
  }

  const normalized = direction.replace(/_/g, "-");
  if (!PATCH_NEIGHBOR_DIRECTION_SET.has(normalized)) {
    throw new Error(`Unsupported neighbor direction "${direction}". Use ${PATCH_NEIGHBOR_DIRECTIONS.join(", ")}.`);
  }

  return normalized;
}

function splitTopLevelCommas(source: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function literal(value: string | number | boolean | string[] | number[]) {
  return typeof value === "string" || Array.isArray(value)
    ? JSON.stringify(value)
    : String(value);
}

function toJsIdentifier(name: string) {
  return name.replace(/-([a-zA-Z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function inferExpressionType(
  expression: PetsExpression,
  context: ExpressionContext,
  model: PetsModel,
): PetsType | null {
  const trimmed = expression.source.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("if ")) {
    const thenIndex = findTopLevelKeyword(trimmed, "then");
    if (thenIndex !== -1) {
      const branches = trimmed.slice(thenIndex + "then".length);
      const elseIndex = findTopLevelKeyword(branches, "else");
      if (elseIndex !== -1) {
        const consequent = branches.slice(0, elseIndex).trim();
        return inferExpressionType({ source: consequent }, context, model);
      }
    }
  }

  // 1. Literal checks
  if (trimmed === "true" || trimmed === "false") {
    return { kind: "boolean" };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return { kind: "number" };
  }
  if (/^"[^"]*"$/.test(trimmed) || /^'[^']*'$/.test(trimmed)) {
    return { kind: "string" };
  }
  if (trimmed === "nobody") {
    return { kind: "ref", to: "any" };
  }
  if (trimmed === "self") {
    if (!context.agentSet) {
      throw new Error("self is only available inside agent contexts.");
    }
    return { kind: "ref", to: context.agentSet };
  }
  if (trimmed === "mine") {
    if (!context.askerAgentSet) {
      throw new Error("mine is only available inside nested queries.");
    }
    return { kind: "ref", to: context.askerAgentSet };
  }

  // 2. Local variable check
  if (context.localTypes && context.localTypes.has(trimmed)) {
    return context.localTypes.get(trimmed)!;
  }

  // 3. Check for def / function call
  const fnMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*\(/);
  if (fnMatch) {
    const openParenIndex = trimmed.indexOf("(");
    const closeParenIndex = findMatchingParen(trimmed, openParenIndex);
    if (closeParenIndex === trimmed.length - 1) {
      const fnName = fnMatch[1];
      const argsSource = trimmed.slice(openParenIndex + 1, closeParenIndex);
      if (fnName === "zone-at") {
        const arg = argsSource.trim().split(",")[0].trim();
        return { kind: "ref", to: arg };
      }
      if (fnName === "patch-at" || fnName === "patch-ahead" || fnName === "patch-left-and-ahead" || fnName === "patch-right-and-ahead" || fnName === "neighbor-at") {
        return { kind: "ref", to: "patch" };
      }
      if (fnName === "nearest") {
        const arg = argsSource.trim();
        if (context.breedNames.has(arg)) {
          return { kind: "ref", to: arg };
        }
        if (arg === "patches" || arg === "neighbors4" || arg === "neighbors8") {
          return { kind: "ref", to: "patch" };
        }
      }
      const numericBuiltins = new Set([
        "random", "random-float", "random-int", "floor", "ceil", "round", "abs", "min", "max",
        "sqrt", "pow", "sin", "cos", "tan", "atan", "ln", "log", "exp", "distance", "distance-to"
      ]);
      if (numericBuiltins.has(fnName)) {
        return { kind: "number" };
      }
      if (fnName === "any") {
        return { kind: "boolean" };
      }
      const def = model.defs.find((d) => d.name === fnName);
      if (def) {
        return def.returnType;
      }
    }
  }

  // 4. Identifier checks (no parens)
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed)) {
    const param = model.params.find((p) => p.name === trimmed);
    if (param) return param.type;

    const mem = model.memory.find((m) => m.name === trimmed);
    if (mem) return mem.type;

    const mon = model.monitors.find((m) => m.name === trimmed);
    if (mon) return mon.type;

    if (context.agentSet) {
      const breed = model.pets.find((b) => b.name === context.agentSet);
      if (breed) {
        const field = breed.fields.find((f) => f.name === trimmed);
        if (field) return field.type;
      }
      const link = model.links.find((b) => b.name === context.agentSet);
      if (link) {
        const field = link.fields.find((f) => f.name === trimmed);
        if (field) return field.type;
      }
      const zone = model.zones.find((z) => z.name === context.agentSet);
      if (zone) {
        const field = zone.fields.find((f) => f.name === trimmed);
        if (field) return field.type;
      }
    }

    if (isPatchLikeAgentSet(context.agentSet, context)) {
      const field = model.patches.find((f) => f.name === trimmed);
      if (field) return field.type;
    }

    if (trimmed === "x" || trimmed === "y" || trimmed === "px" || trimmed === "py" || trimmed === "heading" || trimmed === "size" || trimmed === "color") {
      return { kind: "number" };
    }
    if (trimmed === "hidden" || trimmed === "decided") {
      return { kind: "boolean" };
    }
    if (trimmed === "shape" || trimmed === "label" || trimmed === "breed") {
      return { kind: "string" };
    }

    if (context.enumValues?.has(trimmed)) {
      return { kind: "enum", values: [trimmed] };
    }
  }

  // 5. Look for field access
  const fieldAccessMatch = trimmed.match(/^(.+)\.([A-Za-z][A-Za-z0-9_-]*)$/);
  if (fieldAccessMatch) {
    const objExpr = fieldAccessMatch[1].trim();
    const fieldName = fieldAccessMatch[2];

    if (objExpr === "patch") {
      const patchField = model.patches.find((f) => f.name === fieldName);
      if (patchField) return patchField.type;
    }

    const objType = inferExpressionType({ source: objExpr }, context, model);
    if (objType && objType.kind === "enum") {
      const breed = model.pets.find((b) => b.name === objType.values[0]) ||
                    model.links.find((l) => l.name === objType.values[0]);
      if (breed) {
        const field = breed.fields.find((f) => f.name === fieldName);
        if (field) return field.type;
      }
    }

    if (objType && objType.kind === "ref") {
      if (objType.to === "patch") {
        const patchField = model.patches.find((f) => f.name === fieldName);
        if (patchField) return patchField.type;
      } else {
        const breed = model.pets.find((b) => b.name === objType.to) ||
                      model.links.find((l) => l.name === objType.to) ||
                      model.zones.find((z) => z.name === objType.to);
        if (breed) {
          const field = breed.fields.find((f) => f.name === fieldName);
          if (field) return field.type;
        }
      }
    }

    if (fieldName === "x" || fieldName === "y" || fieldName === "heading" || fieldName === "size" || fieldName === "color") {
      return { kind: "number" };
    }
    if (fieldName === "hidden" || fieldName === "decided") {
      return { kind: "boolean" };
    }
    if (fieldName === "shape" || fieldName === "label" || fieldName === "breed") {
      return { kind: "string" };
    }
  }

  // 5.5. Agent query reporters
  const agentQueryMatch = trimmed.match(/^(one-of|nearest-one-of|min-one-of|max-one-of)\s+(.+)$/);
  if (agentQueryMatch) {
    const agentset = agentQueryMatch[2].trim();
    const firstWord = agentset.match(/^[A-Za-z][A-Za-z0-9_-]*/)?.[0];
    if (firstWord) {
      if (firstWord === "patches" || firstWord === "neighbors4" || firstWord === "neighbors8") {
        return { kind: "ref", to: "patch" };
      }
      if (context.breedNames.has(firstWord)) {
        return { kind: "ref", to: firstWord };
      }
    }
  }

  if (trimmed.startsWith("count ") || trimmed.startsWith("sum ") || trimmed.startsWith("mean ") || trimmed.startsWith("min ") || trimmed.startsWith("max ")) {
    return { kind: "number" };
  }
  if (trimmed.startsWith("any ")) {
    return { kind: "boolean" };
  }

  // 6. Operators / compound expressions
  if (/\s+(=|<|>|<=|>=|!=|in)\s+/.test(trimmed)) {
    return { kind: "boolean" };
  }
  if (/\b(and|or)\b/.test(trimmed) || trimmed.startsWith("not ")) {
    return { kind: "boolean" };
  }
  if (/\s*(\+|-|\*|\/|%)\s*/.test(trimmed)) {
    return { kind: "number" };
  }

  return null;
}

function typesMatch(expected: PetsType, actual: PetsType): boolean {
  if (expected.kind === "ref" && actual.kind === "ref") {
    return expected.to === "any" || actual.to === "any" || expected.to === actual.to;
  }
  if (expected.kind === actual.kind) {
    if (expected.kind === "enum" && actual.kind === "enum") {
      return actual.values.every((val) => expected.values.includes(val));
    }
    return true;
  }
  if (expected.kind === "string" && actual.kind === "enum") {
    return true;
  }
  if (expected.kind === "enum" && actual.kind === "string") {
    return true;
  }
  return false;
}

function formatType(type: PetsType | null): string {
  if (!type) return "unknown";
  if (type.kind === "enum") {
    return type.values.join(" | ");
  }
  if (type.kind === "ref") {
    return type.to;
  }
  return type.kind;
}
