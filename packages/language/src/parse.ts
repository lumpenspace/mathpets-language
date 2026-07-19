import { Tree } from "@lezer/common";
import { parser } from "./generated/parser";
import { expandTeams } from "./teams";
import type {
  PetsActionDef,
  PetsAgentAction,
  PetsAssignment,
  PetsCommandStatement,
  PetsCreateStatement,
  PetsPetBreed,
  PetsPetField,
  PetsDef,
  PetsDefParam,
  PetsDefStatement,
  PetsDiagnostic,
  PetsExpression,
  PetsLinkBreed,
  PetsLinkField,
  PetsMemoryField,
  PetsModel,
  PetsMonitor,
  PetsParam,
  PetsParseResult,
  PetsPatchField,
  PetsStatement,
  PetsStep,
  PetsRoundSection,
  PetsType,
  PetsWhereBlock,
  PetsWorld,
  PetsZoneBreed,
  PetsZoneField,
} from "./ast";

interface ConcreteNode {
  name: string;
  from: number;
  to: number;
  isError: boolean;
  children: ConcreteNode[];
}

interface SemanticSection {
  name: string;
  header: string;
  lines: string[];
}

interface StatementLine {
  indent: number;
  text: string;
}

interface ParseContext {
  petBreeds: Set<string>;
}

interface DefHeader {
  name: string;
  params: string;
  returnType: string;
}

const SECTION_HEADERS = [
  "model",
  "defs",
  "world",
  "params",
  "memory",
  "monitors",
  "patches",
  "zones",
  "pets",
  "links",
  "setup",
  "step",
  "round",
  "brush",
  "stop",
] as const;

const DECLARATION_SECTIONS = new Set(["params", "memory", "monitors", "patches", "zones"]);
const STATEMENT_SECTIONS = new Set(["setup", "step", "round", "brush"]);
// Optional section-header modifier: `step staged:`, `turn staged:`,
// `round async:`, `turn 8:` (decision deadline in seconds).
const SECTION_MODIFIER = String.raw`(?:\s+(?:staged|async|\d+(?:\.\d+)?))?`;
const SECTION_HEADER_PATTERN = new RegExp(`^([A-Za-z][A-Za-z0-9_-]*)${SECTION_MODIFIER}\\s*:`);
const COMMAND_NAMES = "forward|turn|face|set-random-position|set-position|move-to|diffuse|die|hatch|kill|kill-one|create-link-with|create-link-to|die-link|turn-towards|turn-away|follow-patch-gradient";
const COMMAND_PATTERN = new RegExp(`^(${COMMAND_NAMES})\\s*\\(`);
const COMMAND_CALL_PATTERN = new RegExp(`\\b(${COMMAND_NAMES})\\s*\\(`);
const ZERO_ARG_COMMAND_NAMES = "die|set-random-position";
const ZERO_ARG_COMMAND_PATTERN = new RegExp(`^(${ZERO_ARG_COMMAND_NAMES})\\s*$`);
const BLOCK_COMMENT_DELIMITER = '"""';

const activeBreedNames = new Set<string>();

export function parsePets(source: string): PetsParseResult {
  activeBreedNames.clear();
  const petsIndex = source.indexOf("pets:");
  if (petsIndex !== -1) {
    const rest = source.slice(petsIndex + 5);
    const nextSectionIndex = rest.search(/^[a-z]+:/m);
    const petsContent = nextSectionIndex === -1 ? rest : rest.slice(0, nextSectionIndex);
    for (const line of petsContent.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:(?:pet|pet|player)\s+)?([A-Za-z][A-Za-z0-9_-]*)\s*:\s*$/);
      if (match && match[1] !== "actions") {
        activeBreedNames.add(match[1]);
      }
    }
  }

  if (hasUndefinedIdentifier(source)) {
    return {
      model: null,
      diagnostics: [
        {
          message: "there is no `undefined` in Pets — test the lookup itself: `where (not pet-at(...))`.",
          from: 0,
          to: source.length,
        },
      ],
    };
  }

  // Teams are a source-to-source expansion (docs/teams-design.md): the
  // grammar and builder only ever see the stamped per-team breeds.
  const expansion = expandTeams(stripPetsComments(source));
  if (expansion.diagnostics.length > 0) {
    return { model: null, diagnostics: expansion.diagnostics };
  }

  const expandedSource = expansion.source;
  const semanticSource = prepareSemanticSource(expandedSource);
  const parseSource = prepareParseSource(expandedSource);
  const tree = parser.parse(parseSource);
  const diagnostics = collectDiagnostics(tree, parseSource);

  if (diagnostics.length > 0) {
    return { model: null, diagnostics };
  }

  try {
    return {
      model: buildModel(toConcreteTree(tree.cursor()), parseSource, semanticSource),
      diagnostics: [],
    };
  } catch (error) {
    return {
      model: null,
      diagnostics: [
        {
          message: error instanceof Error ? error.message : "Could not parse MathPets source.",
          from: 0,
          to: source.length,
        },
      ],
    };
  }
}

function hasUndefinedIdentifier(source: string): boolean {
  const noComments = stripPetsComments(source);
  const noStrings = noComments.replace(/"([^"\\]|\\.)*"/g, '""').replace(/'([^'\\]|\\.)*'/g, "''");
  return /(?<![A-Za-z0-9_-])undefined(?![A-Za-z0-9_-])/.test(noStrings);
}

function prepareSemanticSource(source: string) {
  const normalizedLines = stripPetsComments(source)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const normalized = normalizedLines.join("\n");
  return normalized.length > 0 ? `${normalized}\n` : normalized;
}

function prepareParseSource(source: string) {
  const normalizedLines = stripPetsComments(source)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const normalized = stripStatementBodiesForParser(normalizedLines).join("\n");

  return normalized.length > 0 ? `${normalized}\n` : normalized;
}

function stripPetsComments(source: string) {
  let output = "";
  let index = 0;
  let quote: '"' | "'" | null = null;

  while (index < source.length) {
    const character = source[index];
    const previous = source[index - 1];

    if (!quote && source.startsWith(BLOCK_COMMENT_DELIMITER, index)) {
      index += BLOCK_COMMENT_DELIMITER.length;

      while (index < source.length && !source.startsWith(BLOCK_COMMENT_DELIMITER, index)) {
        const blockCharacter = source[index];
        if (blockCharacter === "\n" || blockCharacter === "\r") {
          output += blockCharacter;
        }
        index += 1;
      }

      if (source.startsWith(BLOCK_COMMENT_DELIMITER, index)) {
        index += BLOCK_COMMENT_DELIMITER.length;
      }
      continue;
    }

    if (!quote && character === "#") {
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") {
        index += 1;
      }
      continue;
    }

    output += character;

    if ((character === '"' || character === "'") && previous !== "\\") {
      quote = quote === character ? null : quote ?? character;
    }

    index += 1;
  }

  return output;
}

function stripStatementBodiesForParser(lines: string[]) {
  const stripped: string[] = [];
  let section: string | null = null;
  let petActionsParentIndent: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = line.match(SECTION_HEADER_PATTERN);

    if (indentSize(line) === 0 && sectionMatch && isSectionHeader(sectionMatch[1])) {
      section = normalizeSectionName(sectionMatch[1]);
      petActionsParentIndent = null;
      stripped.push(line);
      continue;
    }

    if (section && STATEMENT_SECTIONS.has(section)) {
      if (indentSize(line) > 0) {
        continue;
      }
    }

    if (section === "defs" && indentSize(line) > 0 && !isDefHeaderSource(trimmed)) {
      continue;
    }

    if (section === "pets") {
      const indent = indentSize(line);

      if (petActionsParentIndent !== null) {
        if (indent > petActionsParentIndent) {
          continue;
        }

        petActionsParentIndent = null;
      }

      if (isActionsHeaderSource(trimmed)) {
        petActionsParentIndent = indent;
        continue;
      }
    }

    stripped.push(line);
  }

  return stripped;
}

function isActionsHeaderSource(source: string) {
  return /^actions\s*:\s*$/.test(source);
}

function isDefHeaderSource(source: string) {
  return /^[A-Za-z][A-Za-z0-9_-]*\s*\(.*\)\s*:\s*.+?\s*:\s*$/.test(source);
}

function indentSize(line: string) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function collectDiagnostics(tree: Tree, source: string): PetsDiagnostic[] {
  const diagnostics: PetsDiagnostic[] = [];
  const seen = new Set<string>();
  const cursor = tree.cursor();

  do {
    if (cursor.type.isError) {
      const message = describePetsSyntaxError(source, cursor.from, cursor.to);
      const lineStart = source.lastIndexOf("\n", Math.max(0, cursor.from - 1)) + 1;
      const key = `${lineStart}:${message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      diagnostics.push({
        message,
        from: cursor.from,
        to: cursor.to,
      });
    }
  } while (cursor.next());

  return diagnostics;
}

export function describePetsSyntaxError(source: string, from: number, to: number) {
  const context = getSyntaxErrorContext(source, from, to);
  const hint = inferSyntaxHint(context);

  if (context.statement.length === 0) {
    return hint;
  }

  return `${hint} Statement: \`${truncateForDiagnostic(context.statement)}\``;
}

interface SyntaxErrorContext {
  statement: string;
  section: string | null;
  token: string;
}

function getSyntaxErrorContext(source: string, from: number, to: number): SyntaxErrorContext {
  const safeFrom = clamp(from, 0, source.length);
  const safeTo = clamp(to, safeFrom, source.length);
  const lineStart = source.lastIndexOf("\n", Math.max(0, safeFrom - 1)) + 1;
  const nextLineBreak = source.indexOf("\n", safeFrom);
  const lineEnd = nextLineBreak === -1 ? source.length : nextLineBreak;
  const lineText = source.slice(lineStart, lineEnd);
  const tokenText = source.slice(safeFrom, safeTo).trim();

  return {
    statement: lineText.trim(),
    section: findSectionBefore(source, lineStart),
    token: tokenText || findTokenNear(lineText, safeFrom - lineStart),
  };
}

function inferSyntaxHint({ statement, section, token }: SyntaxErrorContext) {
  if (statement.length === 0) {
    return "MathPets could not parse this blank line. Add a statement or remove the stray token.";
  }

  const modelMatch = statement.match(/^model\s+([A-Za-z][A-Za-z0-9_-]*)$/);
  if (modelMatch) {
    return `Missing ":" after the model name. Model declarations are written like \`model ${modelMatch[1]}:\`.`;
  }

  const sectionMatch = statement.match(new RegExp(`^([A-Za-z][A-Za-z0-9_-]*)${SECTION_MODIFIER}$`));
  if (sectionMatch && isSectionHeader(sectionMatch[1])) {
    return `Missing ":" after \`${sectionMatch[1]}\`. Section headers are written like \`${sectionMatch[1]}:\`.`;
  }

  if (hasUnclosedDelimiter(statement, "(", ")")) {
    return "Missing a closing `)`. Parenthesized expressions and function calls must close before the line ends.";
  }

  if (hasUnclosedDelimiter(statement, "[", "]")) {
    return "Missing a closing `]`. Set literals are written like `[alive, newborn]`.";
  }

  if (/\b(and|or|then|else|where|report|not|in)$/.test(statement)) {
    return `The keyword \`${statement.split(/\s+/).at(-1)}\` needs an expression after it.`;
  }

  if (
    /[+\-*\/%<>=!]$/.test(statement) &&
    !statement.endsWith("<-") &&
    !statement.endsWith(":=")
  ) {
    return `The operator \`${statement.at(-1)}\` needs a value after it.`;
  }

  if (section === "world") {
    if (/^[xy]\b/.test(statement)) {
      return "World ranges use `x: min..max` or `y: min..max`, for example `x: -25..25`.";
    }

    if (/^topology\b/.test(statement)) {
      return "Topology declarations use `topology: box` or `topology: torus`.";
    }

    return "World blocks only accept `x`, `y`, and `topology` declarations.";
  }

  if (section === "defs") {
    if (/^def\b/.test(statement)) {
      return "`def` is no longer supported. Function declarations in `defs:` use `name(param: type): return-type:` followed by indented lines.";
    }

    if (/^let\b/.test(statement)) {
      return "Local definitions use `let name: type = expression`.";
    }

    if (/^return\b/.test(statement)) {
      return "Return statements need an expression. You can also omit `return` on the final expression.";
    }

    return "Inside `defs:`, use `name(param: type): return-type:`, then indented `let name: type = expression` lines and a final expression.";
  }

  if (section === "pets") {
    if (/^(?:pet|pet)\b/.test(statement)) {
      return "Pet breed declarations use `pet breed-name:` followed by field declarations.";
    }

    return "Pet fields use `name: type = initial-value`, for example `state: dead | alive = dead`.";
  }

  if (section === "zones") {
    if (/^zone\b/.test(statement)) {
      return "Zone declarations use `zone zone-name size n:` followed by field declarations.";
    }

    return "Zone fields use `name: type = initial-value`, for example `state: growth | stable | cool = stable`.";
  }

  if (section === "links") {
    if (/^link\b/.test(statement)) {
      return "Link breed declarations use `link breed-name directed:` or `link breed-name undirected:`, optionally with `decay <ticks>` before the colon, followed by field declarations.";
    }

    return "Link fields use `name: type = initial-value`, for example `state: open | closed = open`.";
  }

  if (section && DECLARATION_SECTIONS.has(section)) {
    if (!statement.includes(":")) {
      return `Declarations in \`${section}:\` need a type: \`name: type = value\`.`;
    }

    if (!statement.includes("=")) {
      return `Declarations in \`${section}:\` need an initial value after \`=\`.`;
    }

    if (/\benum\s*\([^)]*$/.test(statement)) {
      return "Enum types use `value1 | value2 | ...`, for example `state: empty | tree = empty`.";
    }

    return `Declarations in \`${section}:\` use \`name: type = value\`.`;
  }

  if (section && STATEMENT_SECTIONS.has(section)) {
    if (/^create\b/.test(statement)) {
      return "Create statements use `create breed count`, for example `create cells 10`, or a counted spawn block such as `10 cells:` followed by `spawn`.";
    }

    if (statement.includes("=") && !hasAssignArrow(statement)) {
      return "Assignments in `setup:` and `step:` use `:=`, not `=`. For example: `patches:` followed by an indented `state := tree`.";
    }

    if (statement.includes(":") && !hasAssignArrow(statement) && !COMMAND_CALL_PATTERN.test(statement)) {
      return "Agent updates use `agentset:` or `agentset where (...):` followed by indented actions.";
    }

    if (!hasAssignArrow(statement) && !COMMAND_CALL_PATTERN.test(statement)) {
      return "Statements in `setup:` and `step:` are assignments, agent updates, commands, `create breed count`, or counted spawn blocks.";
    }

    return "Assignments use `field := expression`; agent updates use `agentset:` followed by an indented block.";
  }

  if (section === "stop") {
    return "Stop conditions use `stop when (condition)`, for example `stop when (count patches where burning = 0)`.";
  }

  if (token.length > 0) {
    return `MathPets could not parse \`${token}\` here. Check whether this line is a section header, declaration, or assignment.`;
  }

  return "MathPets could not parse this line. Check whether it should be a section header, declaration, or assignment.";
}

function findSectionBefore(source: string, position: number) {
  let section: string | null = null;
  const prefix = source.slice(0, position);

  for (const rawLine of prefix.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const sectionMatch = trimmed.match(SECTION_HEADER_PATTERN);
    if (sectionMatch && isSectionHeader(sectionMatch[1])) {
      section = normalizeSectionName(sectionMatch[1]);
    }
  }

  return section;
}

function isSectionHeader(value: string): value is (typeof SECTION_HEADERS)[number] {
  return SECTION_HEADERS.includes(value as (typeof SECTION_HEADERS)[number]);
}

function normalizeSectionName(value: string) {
  return value;
}

function findTokenNear(lineText: string, column: number) {
  const safeColumn = clamp(column, 0, lineText.length);
  const rightMatch = lineText.slice(safeColumn).match(/[A-Za-z0-9_<>=!+\-*\/%.()[\],:]+/);
  if (rightMatch?.[0]) {
    return rightMatch[0];
  }

  const leftMatch = lineText.slice(0, safeColumn).match(/[A-Za-z0-9_<>=!+\-*\/%.()[\],:]+$/);
  return leftMatch?.[0] ?? "";
}

function hasUnclosedDelimiter(source: string, open: string, close: string) {
  let depth = 0;
  for (const character of source) {
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth > 0;
}

function truncateForDiagnostic(value: string) {
  return value.length <= 96 ? value : `${value.slice(0, 93)}...`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toConcreteTree(cursor: ReturnType<Tree["cursor"]>): ConcreteNode {
  const node: ConcreteNode = {
    name: cursor.name,
    from: cursor.from,
    to: cursor.to,
    isError: cursor.type.isError,
    children: [],
  };

  if (cursor.firstChild()) {
    do {
      node.children.push(toConcreteTree(cursor));
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return node;
}

function buildModel(root: ConcreteNode, source: string, semanticSource: string): PetsModel {
  const semanticSections = splitTopLevelSections(semanticSource);
  validateSemanticIndentation(semanticSections);
  const parsedPets = parsePetsSection(semanticSections.find((section) => section.name === "pets"));
  const breedNames = new Set(parsedPets.breeds.map((breed) => breed.name));
  const context: ParseContext = {
    petBreeds: breedNames,
  };

  const model: PetsModel = {
    name: parseModelName(findFirst(root, "ModelDeclaration"), source) ?? "Untitled",
    defs: parseDefsSection(semanticSections.find((section) => section.name === "defs"), breedNames),
    world: parseWorld(findFirst(root, "WorldSection"), source),
    params: findAllOptional(root, "ParamsSection", "ParamDeclaration").map((node) =>
      parseParam(node, source, breedNames),
    ),
    memory: findAllOptional(root, "MemorySection", "MemoryDeclaration").map((node) =>
      parseMemoryField(node, source, breedNames),
    ),
    monitors: findAllOptional(root, "MonitorsSection", "MonitorDeclaration").map((node) =>
      parseMonitor(node, source, breedNames),
    ),
    patches: findAllOptional(root, "PatchesSection", "PatchDeclaration").map((node) =>
      parsePatchField(node, source, breedNames),
    ),
    zones: findAllOptional(root, "ZonesSection", "ZoneDeclaration").map((node) =>
      parseZoneBreed(node, source, breedNames),
    ),
    petActions: parsedPets.actions,
    pets: parsedPets.breeds,
    links: findAllOptional(root, "LinksSection", "LinkDeclaration").map((node) =>
      parseLinkBreed(node, source, breedNames),
    ),
    setup: parseStatementSection(requireSemanticSection(semanticSections, "setup"), context),
    steps: semanticSections
      .filter((section) => section.name === "step")
      .map((section) => parseSemanticStep(section, context)),
    rounds: semanticSections
      .filter((section) => section.name === "round")
      .map((section) => parseSemanticRound(section, context)),
    brush: parseBrushSection(semanticSections.find((section) => section.name === "brush")),
    stop: parseStop(findFirst(root, "StopSection"), source),
  };

  validateRoundModel(model);
  return model;
}

/**
 * Parses the optional `brush:` section.
 *
 * The body reuses the patch-block statement forms (assignments, `let`,
 * `where`/`otherwise`, `match`, `repeat`) but is scoped to the single patch
 * the user clicks, so agent commands and action calls are rejected.
 */
function parseBrushSection(section: SemanticSection | undefined): PetsAgentAction[] | undefined {
  if (!section) {
    return undefined;
  }

  const lines = toStatementLines(section.lines);
  if (lines.length === 0) {
    return undefined;
  }

  const block = parseAgentActionBlock(lines, 0, lines[0].indent);
  if (block.index < lines.length) {
    throw new Error(`Could not parse statement in \`brush:\`: ${lines[block.index].text}`);
  }

  block.items.forEach(ensureBrushAction);
  return block.items;
}

function ensureBrushAction(action: PetsAgentAction) {
  if (action.kind === "command" || action.kind === "action-call") {
    throw new Error(
      "`brush:` only supports patch statements: assignments, `let`, `where`/`otherwise`, `match`, and `repeat`.",
    );
  }

  if (action.kind === "where") {
    action.body.forEach(ensureBrushAction);
    action.otherwiseBody?.forEach(ensureBrushAction);
  }

  if (action.kind === "repeat") {
    action.body.forEach(ensureBrushAction);
  }
}

function splitTopLevelSections(source: string): SemanticSection[] {
  const sections: SemanticSection[] = [];
  let current: SemanticSection | null = null;

  for (const line of source.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    const sectionName = topLevelSectionName(line);
    if (sectionName) {
      current = {
        name: normalizeSectionName(sectionName),
        header: line.trim(),
        lines: [],
      };
      sections.push(current);
      continue;
    }

    current?.lines.push(line);
  }

  return sections;
}

function topLevelSectionName(line: string) {
  if (indentSize(line) !== 0) {
    return null;
  }

  const trimmed = line.trim();
  const modelMatch = trimmed.match(/^model(?:\s+[A-Za-z][A-Za-z0-9_-]*)?\s*:/);
  if (modelMatch) {
    return "model";
  }

  const sectionMatch = trimmed.match(SECTION_HEADER_PATTERN);
  if (sectionMatch && isSectionHeader(sectionMatch[1])) {
    return normalizeSectionName(sectionMatch[1]);
  }

  if (/^stop\s+when\b/.test(trimmed)) {
    return "stop";
  }

  return null;
}

function requireSemanticSection(sections: SemanticSection[], name: string) {
  const section = sections.find((candidate) => candidate.name === name);
  if (!section) {
    throw new Error(`Missing required ${name} section.`);
  }
  return section;
}

function validateSemanticIndentation(sections: SemanticSection[]) {
  for (const section of sections) {
    if (section.name === "stop") {
      continue;
    }

    const lines = toStatementLines(section.lines);
    if (lines.length === 0) {
      continue;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const previous = lines[index - 1];

      if (line.indent === 0) {
        throw new Error(`Lines inside \`${section.header}\` must be indented. Statement: \`${line.text}\`.`);
      }

      if (previous && line.indent > previous.indent && !isBlockHeaderSource(previous.text)) {
        throw new Error(`Unexpected indentation before "${line.text}".`);
      }

      if (!isBlockHeaderSource(line.text)) {
        continue;
      }

      const next = lines[index + 1];
      if (!next || next.indent <= line.indent) {
        throw new Error(`Expected an indented block after "${line.text}".`);
      }
    }
  }
}

function isBlockHeaderSource(source: string) {
  return /:\s*$/.test(source);
}

function parseDefsSection(section: SemanticSection | undefined, breedNames?: Set<string>): PetsDef[] {
  if (!section) {
    return [];
  }

  const lines = toStatementLines(section.lines);
  const defs: PetsDef[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const header = parseDefHeader(line.text, breedNames);

    if (!header) {
      if (/^def\b/.test(line.text)) {
        throw new Error(`\`def\` is no longer supported in \`defs:\`. Use \`${line.text.replace(/^def\s+/, "")}\`.`);
      }
      throw new Error(`Expected a function declaration in \`defs:\`. Statement: \`${line.text}\`.`);
    }

    const child = parseRequiredDefBlock(lines, index, line.indent, header.name);
    defs.push(parseSemanticDef(header, child.items, breedNames));
    index = child.index;
  }

  return defs;
}

function parseDefHeader(source: string, breedNames?: Set<string>): DefHeader | null {
  const match = source.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*\((.*)\)\s*:\s*(.+?)\s*:\s*$/);
  if (!match) {
    return null;
  }

  if (match[1] === "mine" || match[1] === "self" || match[1] === "nobody" || match[1] === "patch") {
    throw new Error(`\`${match[1]}\` is a reserved name and cannot be used as a def.`);
  }

  return {
    name: match[1],
    params: match[2],
    returnType: match[3],
  };
}

function parseSemanticDef(header: DefHeader, statementLines: StatementLine[], breedNames?: Set<string>): PetsDef {
  const statements = statementLines.map((line) => parseDefStatement(line.text, breedNames));
  const normalizedStatements = normalizeDefReturns(header.name, statements);

  return {
    name: header.name,
    params: parseDefParams(header.params, breedNames),
    returnType: parseType(header.returnType, breedNames),
    statements: normalizedStatements,
  };
}

function parseRequiredDefBlock(
  lines: StatementLine[],
  index: number,
  parentIndent: number,
  name: string,
): { items: StatementLine[]; index: number } {
  const next = lines[index + 1];
  if (!next || next.indent <= parentIndent) {
    throw new Error(`Expected an indented function block after "${name}(...):".`);
  }

  const items: StatementLine[] = [];
  let childIndex = index + 1;
  const childIndent = next.indent;

  while (childIndex < lines.length) {
    const line = lines[childIndex];
    if (line.indent < childIndent) {
      break;
    }

    if (line.indent > childIndent) {
      throw new Error(`Unexpected indentation before "${line.text}".`);
    }

    items.push(line);
    childIndex += 1;
  }

  return { items: items, index: childIndex };
}

function parseDefParams(source: string, breedNames?: Set<string>): PetsDefParam[] {
  const text = source.trim();
  if (!text) {
    return [];
  }

  return splitTopLevelCommas(text).map((param) => {
    const match = matchRequired(
      param.trim(),
      /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/,
      "function parameter",
    );

    if (match[1] === "mine" || match[1] === "self" || match[1] === "nobody" || match[1] === "patch") {
      throw new Error(`\`${match[1]}\` is a reserved name and cannot be used as a function parameter.`);
    }

    return {
      name: match[1],
      type: parseType(match[2], breedNames),
    };
  });
}

function parseDefStatement(text: string, breedNames?: Set<string>): PetsDefStatement {
  if (text.startsWith("let ")) {
    const match = matchRequired(
      text,
      /^let\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s*:\s*(.+?))?\s*=\s*(.+)$/,
      "let statement",
    );

    if (match[1] === "mine" || match[1] === "self" || match[1] === "nobody" || match[1] === "patch") {
      throw new Error(`\`${match[1]}\` is a reserved name and cannot be used as a local variable.`);
    }

    return {
      kind: "let",
      name: match[1],
      type: match[2] ? parseType(match[2], breedNames) : undefined,
      expression: expression(match[3]),
    };
  }

  if (text.startsWith("return ")) {
    const match = matchRequired(text, /^return\s+(.+)$/, "return statement");
    return {
      kind: "return",
      expression: expression(match[1]),
    };
  }

  return {
    kind: "expression",
    expression: expression(text),
  };
}

function normalizeDefReturns(name: string, statements: PetsDefStatement[]): PetsDefStatement[] {
  if (statements.length === 0) {
    throw new Error(`Function "${name}" must return a value.`);
  }

  const expressionStatementIndex = statements.findIndex((statement) => statement.kind === "expression");
  if (expressionStatementIndex !== -1 && expressionStatementIndex !== statements.length - 1) {
    throw new Error(`Plain expressions in function "${name}" are only allowed as the final implicit return.`);
  }

  const lastStatement = statements.at(-1);
  if (lastStatement?.kind === "expression") {
    return [
      ...statements.slice(0, -1),
      {
        kind: "return",
        expression: lastStatement.expression,
      },
    ];
  }

  if (!statements.some((statement) => statement.kind === "return")) {
    throw new Error(`Function "${name}" must end with a return statement or expression.`);
  }

  return statements;
}

const DEFAULT_WORLD: PetsWorld = {
  minX: -25,
  maxX: 25,
  minY: -18,
  maxY: 18,
  topology: "box",
};

function parseModelName(node: ConcreteNode | undefined, source: string) {
  if (!node) {
    return undefined;
  }

  const match = textOf(node, source).match(/\bmodel\s+([A-Za-z][A-Za-z0-9_-]*)/);
  return match?.[1];
}

function parseWorld(node: ConcreteNode | undefined, source: string): PetsWorld {
  if (!node) {
    return { ...DEFAULT_WORLD };
  }

  const text = textOf(node, source);
  const x = text.match(/^\s*x\s*:\s*(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)/m);
  const y = text.match(/^\s*y\s*:\s*(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)/m);
  const topology = text.match(/^\s*topology\s*:\s*(torus|box|wrap-x|wrap-y)/m);

  return {
    minX: x ? Number(x[1]) : DEFAULT_WORLD.minX,
    maxX: x ? Number(x[2]) : DEFAULT_WORLD.maxX,
    minY: y ? Number(y[1]) : DEFAULT_WORLD.minY,
    maxY: y ? Number(y[2]) : DEFAULT_WORLD.maxY,
    topology: topology ? (topology[1] as PetsWorld["topology"]) : DEFAULT_WORLD.topology,
  };
}

function parseParam(node: ConcreteNode, source: string, breedNames?: Set<string>): PetsParam {
  const text = oneLine(node, source);
  const match = matchRequired(
    text,
    /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*=\s*(.+)$/,
    "param declaration",
  );

  if (match[1] === "mine" || match[1] === "self" || match[1] === "nobody" || match[1] === "patch") {
    throw new Error(`\`${match[1]}\` is a reserved name and cannot be used as a param.`);
  }

  return {
    name: match[1],
    type: parseType(match[2], breedNames),
    control: parseControl(match[3], parseType(match[2], breedNames)),
  };
}

function parseMonitor(node: ConcreteNode, source: string, breedNames?: Set<string>): PetsMonitor {
  const text = oneLine(node, source);
  const match = matchRequired(
    text,
    /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*=\s*(.+)$/,
    "monitor declaration",
  );

  rejectReservedFieldName(match[1], "monitor");

  return {
    name: match[1],
    type: parseType(match[2], breedNames),
    expression: expression(match[3]),
  };
}

const RESERVED_FIELD_NAMES = new Set(["patch", "mine", "nobody", "self"]);

function rejectReservedFieldName(name: string, kind: string) {
  if (RESERVED_FIELD_NAMES.has(name)) {
    throw new Error(
      `\`${name}\` is a reserved name and cannot be used as a ${kind} field.`,
    );
  }
}

function parseMemoryField(node: ConcreteNode, source: string, breedNames?: Set<string>): PetsMemoryField {
  const text = oneLine(node, source);
  const match = matchRequired(
    text,
    /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*=\s*(.+)$/,
    "memory declaration",
  );

  rejectReservedFieldName(match[1], "memory");

  const type = parseType(match[2], breedNames);
  const initialSource = type.kind === "set" ? stringifyBareSetElements(match[3]) : match[3];

  return {
    name: match[1],
    type,
    initialValue: expression(initialSource),
  };
}

function stringifyBareSetElements(source: string): string {
  const match = source.trim().match(/^\[\s*(.*?)\s*\]$/s);
  if (!match) {
    return source;
  }
  const body = match[1].trim();
  if (body.length === 0) {
    return "[]";
  }
  const parts = body.split(",").map((part) => part.trim()).filter(Boolean);
  const transformed = parts.map((part) => {
    if (/^-?\d+(?:\.\d+)?$/.test(part)) {
      return part;
    }
    if (/^["'].*["']$/.test(part)) {
      return part;
    }
    return JSON.stringify(part);
  });
  return `[${transformed.join(", ")}]`;
}

function parsePatchField(node: ConcreteNode, source: string, breedNames?: Set<string>): PetsPatchField {
  const text = oneLine(node, source);
  const match = matchRequired(
    text,
    /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*=\s*(.+)$/,
    "patch declaration",
  );
  const type = parseType(match[2], breedNames);

  rejectReservedFieldName(match[1], "patch");

  if (match[1] === "wall") {
    throw new Error(
      "`wall` is a built-in boolean patch field. Use it directly (e.g. `wall := true`) without declaring it in `patches:`.",
    );
  }

  return {
    name: match[1],
    type,
    initialValue: parseLiteral(match[3], type),
    states: type.kind === "enum" && match[1] === "state" ? type.values : undefined,
  };
}

function parseZoneBreed(node: ConcreteNode, source: string, breedNames?: Set<string>): PetsZoneBreed {
  const header = firstNonEmptyLine(textOf(node, source)).trim();
  const match = matchRequired(
    header,
    /^zone\s+([A-Za-z][A-Za-z0-9_-]*)\s+size\s+(\d+(?:\.\d+)?)\s*:\s*$/,
    "zone declaration",
  );
  const size = Number(match[2]);

  if (match[1] === "mine" || match[1] === "self" || match[1] === "nobody" || match[1] === "patch") {
    throw new Error(`\`${match[1]}\` is a reserved name and cannot be used as a zone breed.`);
  }

  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`Zone "${match[1]}" size must be a positive number.`);
  }

  return {
    name: match[1],
    size,
    fields: findAll(node, "ZoneFieldDeclaration").map((fieldNode) =>
      parseZoneField(fieldNode, source, breedNames),
    ),
  };
}

function parseZoneField(node: ConcreteNode, source: string, breedNames?: Set<string>): PetsZoneField {
  const text = oneLine(node, source);
  const match = matchRequired(
    text,
    /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*=\s*(.+)$/,
    "zone field declaration",
  );
  const type = parseType(match[2], breedNames);

  rejectReservedFieldName(match[1], "zone");

  return {
    name: match[1],
    type,
    initialValue: parseLiteral(match[3], type),
    states: type.kind === "enum" && match[1] === "state" ? type.values : undefined,
  };
}

function parseLinkBreed(node: ConcreteNode, source: string, breedNames?: Set<string>): PetsLinkBreed {
  const header = firstNonEmptyLine(textOf(node, source)).trim();
  const match = matchRequired(
    header,
    /^(?:link\s+)?([A-Za-z][A-Za-z0-9_-]*)(?:\s+(directed|undirected))?(?:\s+decay\s+(\d+))?\s*:\s*$/,
    "link declaration",
  );

  if (match[1] === "mine" || match[1] === "self" || match[1] === "nobody" || match[1] === "patch") {
    throw new Error(`\`${match[1]}\` is a reserved name and cannot be used as a link breed.`);
  }

  const decay = match[3] === undefined ? undefined : Number(match[3]);
  if (decay !== undefined && decay < 1) {
    throw new Error(`Link decay must be at least 1 tick. Statement: \`${header}\``);
  }

  return {
    name: match[1],
    directed: match[2] === "directed",
    ...(decay === undefined ? {} : { decay }),
    fields: findAll(node, "LinkFieldDeclaration").map((fieldNode) =>
      parseLinkField(fieldNode, source, breedNames),
    ),
  };
}

function parseLinkField(node: ConcreteNode, source: string, breedNames?: Set<string>): PetsLinkField {
  const text = oneLine(node, source);
  const match = matchRequired(
    text,
    /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*=\s*(.+)$/,
    "link field declaration",
  );
  const type = parseType(match[2], breedNames);

  return {
    name: match[1],
    type,
    initialValue: parseLiteral(match[3], type),
    states: type.kind === "enum" && match[1] === "state" ? type.values : undefined,
  };
}

function parsePetsSection(
  section: SemanticSection | undefined,
): {
  actions: PetsActionDef[];
  breeds: PetsPetBreed[];
} {
  if (!section) {
    return { actions: [], breeds: [] };
  }

  const lines = toStatementLines(section.lines);
  if (lines.length === 0) {
    return { actions: [], breeds: [] };
  }

  // Pre-collect all breed names from the pets section
  const breedNames = new Set<string>();
  for (const line of lines) {
    const breedMatch = line.text.match(/^(?:(pet|pet|player)\s+)?([A-Za-z][A-Za-z0-9_-]*)\s*:\s*$/);
    if (breedMatch && breedMatch[2] !== "actions") {
      breedNames.add(breedMatch[2]);
    }
  }

  const actions: PetsActionDef[] = [];
  const breeds: PetsPetBreed[] = [];
  let index = 0;
  const indent = lines[0].indent;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      throw new Error(`Unexpected indentation before "${line.text}".`);
    }

    if (isActionsHeader(line.text)) {
      const child = parseActionDefinitionsBlock(lines, index, indent);
      actions.push(...child.items);
      index = child.index;
      continue;
    }

    // Accepts `pet <name>:` (preferred), `pet <name>:` (legacy), bare
    // `<name>:` and `player <name>:` (a pet breed that takes rounds).
    const breedMatch = line.text.match(/^(?:(pet|pet|player)\s+)?([A-Za-z][A-Za-z0-9_-]*)\s*:\s*$/);
    if (breedMatch && breedMatch[2] !== "actions") {
      const child = parseSemanticPetBreed(
        lines,
        index,
        indent,
        breedMatch[2],
        breedMatch[1] === "player",
        breedNames,
      );
      breeds.push(child.breed);
      index = child.index;
      continue;
    }

    throw new Error(`Expected an actions block or pet breed in \`pets:\`. Statement: \`${line.text}\`.`);
  }

  return {
    actions: ensureUniqueActions(actions, "pets actions"),
    breeds,
  };
}

function parseSemanticPetBreed(
  lines: StatementLine[],
  index: number,
  parentIndent: number,
  name: string,
  isPlayer: boolean,
  breedNames: Set<string>,
): { breed: PetsPetBreed; index: number } {
  if (name === "mine" || name === "self" || name === "nobody" || name === "patch") {
    throw new Error(`\`${name}\` is a reserved name and cannot be used as a breed.`);
  }

  const next = lines[index + 1];
  if (!next || next.indent <= parentIndent) {
    throw new Error(`Expected an indented pet breed block after "${name}:".`);
  }

  const fields: PetsPetField[] = [];
  const actions: PetsActionDef[] = [];
  const childIndent = next.indent;
  let childIndex = index + 1;

  while (childIndex < lines.length) {
    const line = lines[childIndex];
    if (line.indent < childIndent) {
      break;
    }

    if (line.indent > childIndent) {
      throw new Error(`Unexpected indentation before "${line.text}".`);
    }

    if (isActionsHeader(line.text)) {
      const child = parseActionDefinitionsBlock(lines, childIndex, childIndent);
      actions.push(...child.items);
      childIndex = child.index;
      continue;
    }

    fields.push(parsePetFieldLine(line.text, breedNames));
    childIndex += 1;
  }

  return {
    breed: {
      name,
      isPlayer,
      fields,
      actions: ensureUniqueActions(actions, `pet ${name} actions`),
    },
    index: childIndex,
  };
}

function parseActionDefinitionsBlock(
  lines: StatementLine[],
  index: number,
  parentIndent: number,
): { items: PetsActionDef[]; index: number } {
  const next = lines[index + 1];
  if (!next || next.indent <= parentIndent) {
    throw new Error(`Expected action definitions after "${lines[index].text}".`);
  }

  const items: PetsActionDef[] = [];
  const childIndent = next.indent;
  let childIndex = index + 1;

  while (childIndex < lines.length) {
    const line = lines[childIndex];
    if (line.indent < childIndent) {
      break;
    }

    if (line.indent > childIndent) {
      throw new Error(`Unexpected indentation before "${line.text}".`);
    }

    const actionMatch = line.text.match(/^([A-Za-z][A-Za-z0-9_-]*)(?:\s*\((.*)\))?\s*:\s*$/);
    if (!actionMatch || isActionsHeader(line.text)) {
      throw new Error(`Expected an action definition in \`actions:\`. Statement: \`${line.text}\`.`);
    }

    const name = actionMatch[1];
    const paramsText = actionMatch[2];
    if (paramsText === "") {
      throw new Error(`Zero-parameter action "${name}" must be declared without parentheses.`);
    }
    const params = paramsText !== undefined ? parseDefParams(paramsText) : [];

    const body = parseRequiredChildBlock(lines, childIndex, childIndent, `action "${name}"`);
    items.push({
      name,
      params,
      body: body.items,
    });
    childIndex = body.index;
  }

  return {
    items: ensureUniqueActions(items, "actions block"),
    index: childIndex,
  };
}

function isActionsHeader(source: string) {
  return /^actions\s*:\s*$/.test(source);
}

function ensureUniqueActions(actions: PetsActionDef[], label: string) {
  const names = new Set<string>();

  for (const action of actions) {
    if (names.has(action.name)) {
      throw new Error(`Duplicate action "${action.name}" in ${label}.`);
    }

    names.add(action.name);
  }

  return actions;
}

function parsePetFieldLine(text: string, breedNames?: Set<string>): PetsPetField {
  const match = matchRequired(
    text,
    /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*=\s*(.+)$/,
    "pet field declaration",
  );
  const type = parseType(match[2], breedNames);

  rejectReservedFieldName(match[1], "pet");

  return {
    name: match[1],
    type,
    initialValue: parseLiteral(match[3], type),
    states: type.kind === "enum" && match[1] === "state" ? type.values : undefined,
  };
}

function parseType(source: string, breedNames?: Set<string>): PetsType {
  const text = source.trim();

  if (text === "number") {
    return { kind: "number" };
  }

  if (text === "boolean") {
    return { kind: "boolean" };
  }

  if (text === "string") {
    return { kind: "string" };
  }

  if (text === "set") {
    return { kind: "set", element: { kind: "string" } };
  }

  if (text === "patch" || breedNames?.has(text)) {
    return { kind: "ref", to: text };
  }

  const enumMatch = text.match(/^enum\((.*)\)$/);
  if (enumMatch) {
    return {
      kind: "enum",
      values: enumMatch[1].split(",").map((value) => value.trim()).filter(Boolean),
    };
  }

  if (text.includes("|")) {
    const values = text.split("|").map((value) => value.trim()).filter(Boolean);
    if (values.length >= 2 && values.every((value) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(value))) {
      return { kind: "enum", values };
    }
  }

  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(text)) {
    return { kind: "enum", values: [text] };
  }

  throw new Error(`Unsupported type "${text}".`);
}

function parseControl(source: string, type: PetsType): PetsParam["control"] {
  const text = source.trim();
  const sliderMatch = text.match(
    /^slider\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)(?:\s*,\s*step\s+(-?\d+(?:\.\d+)?))?\s*\)$/,
  );

  if (sliderMatch) {
    return {
      kind: "slider",
      value: Number(sliderMatch[1]),
      min: Number(sliderMatch[2]),
      max: Number(sliderMatch[3]),
      step: sliderMatch[4] ? Number(sliderMatch[4]) : undefined,
    };
  }

  const toggleMatch = text.match(/^toggle\(\s*(true|false)\s*\)$/);
  if (toggleMatch) {
    return {
      kind: "toggle",
      value: toggleMatch[1] === "true",
    };
  }

  const selectMatch = text.match(/^select\(\s*(.*?)\s*\)$/);
  if (selectMatch) {
    const options = selectMatch[1].split(",").map((opt) => opt.trim().replace(/^["']|["']$/g, ""));
    return {
      kind: "select",
      value: options[0],
      options,
    };
  }

  if (text === "true" || text === "false") {
    return {
      kind: "literal",
      value: text === "true",
    };
  }

  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return {
      kind: "literal",
      value: Number(text),
    };
  }

  return {
    kind: "literal",
    value: text.replace(/^["']|["']$/g, ""),
  };
}

function parseScalarLiteral(
  source: string,
  type: PetsType,
): string | number | boolean {
  const value = parseLiteral(source, type);
  if (Array.isArray(value)) {
    throw new Error("Parameter controls only support scalar literal values.");
  }
  return value;
}

function parseLiteral(
  source: string,
  type: PetsType,
): string | number | boolean | string[] | number[] {
  const text = source.trim();

  if (type.kind === "number") {
    return Number(text);
  }

  if (type.kind === "boolean") {
    return text === "true";
  }

  if (type.kind === "ref") {
    if (text !== "nobody") {
      throw new Error(`The only allowed default value for reference fields is "nobody".`);
    }
    return -1;
  }

  if (type.kind === "enum" || type.kind === "string") {
    return text.replace(/^["']|["']$/g, "");
  }

  if (type.kind === "set") {
    const inner = text.match(/^\[\s*(.*?)\s*\]$/s);
    if (!inner) {
      throw new Error(`Set field initial value must be a literal "[a, b, ...]" form.`);
    }
    const body = inner[1].trim();
    if (body.length === 0) {
      return [] as string[];
    }
    const parts = body.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.every((part) => /^-?\d+(?:\.\d+)?$/.test(part))) {
      return parts.map(Number);
    }
    return parts.map((part) => part.replace(/^["']|["']$/g, ""));
  }

  return text;
}

function parseSemanticStep(section: SemanticSection, context: ParseContext): PetsStep {
  return {
    staged: /\bstaged\b/.test(section.header),
    statements: parseStatementSection(section, context),
  };
}

function parseSemanticRound(section: SemanticSection, context: ParseContext): PetsRoundSection {
  const match = section.header.match(/^round(?:\s+(staged|async|\d+(?:\.\d+)?))?\s*:\s*$/);
  if (!match) {
    throw new Error(
      `Could not parse round section header: \`${section.header}\`. Use \`round <seconds>:\`, \`round:\`, \`round staged:\`, or \`round async:\`.`,
    );
  }

  const modifier = match[1];
  const mode: PetsRoundSection["mode"] =
    modifier === "staged" ? "staged" : modifier === "async" ? "async" : "plain";
  const deadline = modifier !== undefined && mode === "plain" ? Number(modifier) : undefined;

  if (deadline !== undefined && !(deadline > 0)) {
    throw new Error("The `round` deadline must be greater than 0 seconds.");
  }

  return {
    mode,
    deadline,
    statements: parseStatementSection(section, context),
  };
}

/**
 * Semantic checks for turn-based models (`turn` sections + `decide`
 * statements). Throws — like the rest of the semantic parser — and surfaces
 * as a single diagnostic.
 */
function validateRoundModel(model: PetsModel) {
  const rounds = model.rounds ?? [];
  const breedNames = new Set(model.pets.map((breed) => breed.name));

  const rejectDecides = (actions: PetsAgentAction[] | undefined, where: string) => {
    forEachAgentAction(actions ?? [], (action) => {
      if (action.kind === "decide") {
        throw new Error(
          `\`decide\` is only allowed directly inside a breed block of a non-async \`turn\` section, not in ${where}.`,
        );
      }
    });
  };

  const rejectDecidesInStatements = (statements: PetsStatement[], where: string) => {
    for (const statement of statements) {
      if (statement.kind === "update" || statement.kind === "create") {
        rejectDecides(statement.body, where);
      } else if (statement.kind === "repeat") {
        rejectDecidesInStatements(statement.body, where);
      }
    }
  };

  rejectDecidesInStatements(model.setup, "`setup:`");
  for (const step of model.steps) {
    rejectDecidesInStatements(step.statements, "`step:`");
  }
  rejectDecides(model.brush, "`brush:`");
  for (const action of model.petActions) {
    rejectDecides(action.body, `action "${action.name}"`);
  }
  for (const breed of model.pets) {
    for (const action of breed.actions) {
      rejectDecides(action.body, `action "${action.name}"`);
    }
  }

  if (rounds.length === 0) {
    return;
  }

  // `step` and `round` sections may coexist (mixed models): the `round`
  // sections form the deliberative barrier phase, the `step` sections the
  // autonomic per-round phase. See docs/round-based-models.md
  // "Mixing rounds and steps".

  const deadlines = rounds.filter((turn) => turn.deadline !== undefined);
  if (deadlines.length === 0) {
    throw new Error(
      "Turn-based models must declare the decision deadline on exactly one section: `turn <seconds>:`.",
    );
  }
  if (deadlines.length > 1) {
    throw new Error(
      "Only one `round` section may carry the deadline. Additional sections use `round:`, `round staged:`, or `round async:`.",
    );
  }

  // Collect `decide` declarations from the barrier (non-async) sections.
  const decided = new Map<string, string[]>();
  for (const round of rounds.filter((candidate) => candidate.mode !== "async")) {
    for (const statement of round.statements) {
      if (statement.kind === "update" || statement.kind === "create") {
        const isBreedBlock = statement.kind === "update" && breedNames.has(statement.agentSet);
        const body = statement.body ?? [];
        for (const action of body) {
          if (action.kind !== "decide") {
            // `decide` nested deeper (where/repeat) is rejected below.
            continue;
          }
          if (!isBreedBlock) {
            throw new Error(
              "`decide` is only allowed directly inside a breed block of a non-async `round` section.",
            );
          }
          const breed = model.pets.find(
            (candidate) => candidate.name === (statement as { agentSet: string }).agentSet,
          )!;
          if (!breed.isPlayer) {
            throw new Error(
              `Only player breeds can \`decide\`. Declare "${breed.name}" as \`player ${breed.name}:\` to let it take rounds.`,
            );
          }
          const fields = decided.get(breed.name) ?? [];
          for (const fieldName of action.fields) {
            validateDecideField(breed, fieldName);
            if (!fields.includes(fieldName)) {
              fields.push(fieldName);
            }
          }
          decided.set(breed.name, fields);
        }
        // Nested decide statements (inside where/repeat blocks) are invalid.
        for (const action of body) {
          if (action.kind === "where" || action.kind === "repeat") {
            rejectDecides([action], "a nested block — `decide` must be a direct child of the breed block");
          }
        }
      } else if (statement.kind === "repeat") {
        rejectDecidesInStatements(statement.body, "a `repeat` block");
      }
    }
  }

  if (decided.size === 0) {
    throw new Error(
      "Round-based models must declare at least one `decide <field>` inside a breed block of a `round` section.",
    );
  }

  for (const breedName of decided.keys()) {
    const breed = model.pets.find((candidate) => candidate.name === breedName)!;
    if (breed.fields.some((field) => field.name === "decided")) {
      throw new Error(
        `Breed "${breedName}" declares a field named \`decided\`, but \`decided\` is a built-in field on deciding breeds.`,
      );
    }
  }

  // Async sections: only breed blocks of deciding breeds; no decide statements.
  for (const round of rounds.filter((candidate) => candidate.mode === "async")) {
    rejectDecidesInStatements(round.statements, "`round async:`");
    for (const statement of round.statements) {
      if (statement.kind !== "update" || !breedNames.has(statement.agentSet)) {
        throw new Error(
          "`round async:` sections only allow blocks of player breeds — no patch or observer statements.",
        );
      }
      if (!decided.has(statement.agentSet)) {
        throw new Error(
          `Breed "${statement.agentSet}" is not a deciding player breed, so it cannot appear inside \`round async:\`.`,
        );
      }
    }
  }
}

function validateDecideField(
  breed: PetsPetBreed,
  fieldName: string,
) {
  if (fieldName === "state") {
    throw new Error("`state` cannot be decided. Pick a declared enum, number, or boolean field.");
  }

  const field = breed.fields.find((candidate) => candidate.name === fieldName);
  if (!field) {
    throw new Error(
      `\`decide ${fieldName}\` does not match a declared field of breed "${breed.name}".`,
    );
  }

  if (field.type.kind !== "enum" && field.type.kind !== "number" && field.type.kind !== "boolean") {
    throw new Error(
      `\`decide ${fieldName}\` is not supported: decided fields must be enum, number, or boolean.`,
    );
  }
}

function forEachAgentAction(
  actions: PetsAgentAction[],
  visit: (action: PetsAgentAction) => void,
) {
  for (const action of actions) {
    visit(action);
    if (action.kind === "where") {
      forEachAgentAction(action.body, visit);
      if (action.otherwiseBody) {
        forEachAgentAction(action.otherwiseBody, visit);
      }
    } else if (action.kind === "repeat") {
      forEachAgentAction(action.body, visit);
    }
  }
}

function parseStop(node: ConcreteNode | undefined, source: string): PetsExpression | undefined {
  if (!node) {
    return undefined;
  }

  const match = textOf(node, source).match(/stop\s+when\s+\((.*)\)/s);
  return match ? expression(match[1]) : undefined;
}

function parseStatementSection(section: SemanticSection, context: ParseContext): PetsStatement[] {
  const lines = toStatementLines(section.lines);
  if (lines.length === 0) {
    return [];
  }

  return parseSectionBlock(lines, 0, lines[0].indent, context).items;
}

function toStatementLines(lines: string[]): StatementLine[] {
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => ({
      indent: indentSize(line),
      text: line.trim(),
    }));
}

function parseSectionBlock(
  lines: StatementLine[],
  start: number,
  indent: number,
  context: ParseContext,
): { items: PetsStatement[]; index: number } {
  const items: PetsStatement[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      throw new Error(`Unexpected indentation before "${line.text}".`);
    }

    if (isCreateStatementSource(line.text)) {
      items.push(parseCreateStatement(line.text));
      index += 1;
      continue;
    }

    const createBlockHeader = parseCreateBlockHeader(line.text, context);
    if (createBlockHeader) {
      if (createBlockHeader.bodySource.length > 0) {
        throw new Error("Expected a newline after spawn block header.");
      }

      const child = parseRequiredChildBlock(lines, index, indent, "spawn");
      items.push({
        kind: "create",
        breed: createBlockHeader.breed,
        count: createBlockHeader.count,
        body: normalizeSpawnBlockBody(child.items),
      });
      index = child.index;
      continue;
    }

    const repeatHeader = parseRepeatHeader(line.text);
    if (repeatHeader) {
      if (repeatHeader.bodySource.length > 0) {
        throw new Error("Expected a newline after `repeat`.");
      }

      const child = parseRequiredSectionChildBlock(lines, index, indent, "repeat", context);
      items.push({
        kind: "repeat",
        count: repeatHeader.count,
        index: repeatHeader.index,
        rangeStart: repeatHeader.rangeStart,
        rangeEnd: repeatHeader.rangeEnd,
        body: child.items,
      });
      index = child.index;
      continue;
    }

    const inlineMatch = parseInlineAgentMatchHeader(line.text);
    if (inlineMatch) {
      if (inlineMatch.bodySource.length > 0) {
        throw new Error("Expected a newline after inline `match` header.");
      }
      const armsBlock = parseMatchArmsBlock(lines, index + 1, indent);
      const lowered = lowerMatchArms(
        { discriminators: inlineMatch.discriminators, bodySource: "" },
        armsBlock.arms,
      );
      items.push({
        kind: "update",
        agentSet: inlineMatch.agentSet,
        where: inlineMatch.where,
        body: lowered,
      });
      index = armsBlock.index;
      continue;
    }

    const updateHeader = parseUpdateHeader(line.text);
    if (updateHeader) {
      if (updateHeader.bodySource.length > 0) {
        throw new Error(`Expected a newline after "${updateHeader.headerSource}".`);
      }

      const child = parseRequiredChildBlock(lines, index, indent, "agent update");
      items.push({
        kind: "update",
        agentSet: updateHeader.agentSet,
        where: updateHeader.where,
        body: child.items,
      });
      index = child.index;
      continue;
    }

    if (COMMAND_PATTERN.test(line.text)) {
      items.push(parseCommand(line.text));
      index += 1;
      continue;
    }

    const assignmentBlockHeader = parseAssignmentBlockHeader(line.text);
    if (assignmentBlockHeader) {
      const child = parseAssignmentFieldBlock(lines, index, indent, assignmentBlockHeader.target);
      items.push(...child.items);
      index = child.index;
      continue;
    }

    if (hasAssignArrow(line.text)) {
      items.push(parseAssignment(line.text));
      index += 1;
      continue;
    }

    throw new Error(`Could not parse statement: ${line.text}`);
  }

  return { items, index };
}

function parseAgentActionBlock(
  lines: StatementLine[],
  start: number,
  indent: number,
): { items: PetsAgentAction[]; index: number } {
  const items: PetsAgentAction[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      throw new Error(`Unexpected indentation before "${line.text}".`);
    }

    const otherwiseHeader = parseOtherwiseHeader(line.text);
    if (otherwiseHeader) {
      const previous = items.at(-1);
      if (!previous || previous.kind !== "where" || previous.otherwiseBody) {
        throw new Error("`otherwise:` must follow a `where:` block.");
      }

      if (otherwiseHeader.bodySource.length > 0) {
        throw new Error("Expected a newline after `otherwise:`.");
      }

      const child = parseRequiredChildBlock(lines, index, indent, "otherwise");
      previous.otherwiseBody = child.items;
      index = child.index;
      continue;
    }

    const whereHeader = parseWhereHeader(line.text);
    if (whereHeader) {
      if (whereHeader.bodySource.length > 0) {
        throw new Error("Expected a newline after `where:`.");
      }

      const child = parseRequiredChildBlock(lines, index, indent, "where");
      items.push({
        kind: "where",
        condition: whereHeader.condition,
        body: child.items,
      });
      index = child.index;
      continue;
    }

    const repeatHeader = parseRepeatHeader(line.text);
    if (repeatHeader) {
      if (repeatHeader.bodySource.length > 0) {
        throw new Error("Expected a newline after `repeat`.");
      }

      const child = parseRequiredChildBlock(lines, index, indent, "repeat");
      items.push({
        kind: "repeat",
        count: repeatHeader.count,
        index: repeatHeader.index,
        rangeStart: repeatHeader.rangeStart,
        rangeEnd: repeatHeader.rangeEnd,
        body: child.items,
      });
      index = child.index;
      continue;
    }

    const matchHeader = parseMatchHeader(line.text);
    if (matchHeader) {
      if (matchHeader.bodySource.length > 0) {
        throw new Error("Expected a newline after `match`.");
      }
      const armsBlock = parseMatchArmsBlock(lines, index + 1, indent);
      items.push(...lowerMatchArms(matchHeader, armsBlock.arms));
      index = armsBlock.index;
      continue;
    }

    const assignmentBlockHeader = parseAssignmentBlockHeader(line.text);
    if (assignmentBlockHeader) {
      const child = parseAssignmentFieldBlock(lines, index, indent, assignmentBlockHeader.target);
      items.push(...child.items);
      index = child.index;
      continue;
    }

    items.push(parseAgentAction(line.text));
    index += 1;
  }

  return { items, index };
}

function parseRequiredSectionChildBlock(
  lines: StatementLine[],
  index: number,
  parentIndent: number,
  label: string,
  context: ParseContext,
): { items: PetsStatement[]; index: number } {
  const next = lines[index + 1];
  if (!next || next.indent <= parentIndent) {
    throw new Error(`Expected an indented ${label} block after "${lines[index].text}".`);
  }

  return parseSectionBlock(lines, index + 1, next.indent, context);
}

function parseRequiredChildBlock(
  lines: StatementLine[],
  index: number,
  parentIndent: number,
  label: string,
): { items: PetsAgentAction[]; index: number } {
  const next = lines[index + 1];
  if (!next || next.indent <= parentIndent) {
    throw new Error(`Expected an indented ${label} block after "${lines[index].text}".`);
  }

  return parseAgentActionBlock(lines, index + 1, next.indent);
}

function parseCreateStatement(source: string): PetsCreateStatement {
  const match = matchRequired(
    source.trim(),
    /^create\s+([A-Za-z][A-Za-z0-9_-]*)\s+(.+)$/,
    "create statement",
  );

  return {
    kind: "create",
    breed: match[1],
    count: expression(match[2]),
  };
}

function parseCreateBlockHeader(source: string, context: ParseContext) {
  const match = source.trim().match(/^(.+?)\s+([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }

  const breed = match[2];
  if (!context.petBreeds.has(breed)) {
    return null;
  }

  const countSource = match[1].trim();
  if (
    countSource.length === 0 ||
    /\b(where|match|around|in-radius|in-square)\b/.test(countSource)
  ) {
    return null;
  }

  return {
    breed,
    count: expression(countSource),
    bodySource: match[3].trim(),
  };
}

function normalizeSpawnBlockBody(actions: PetsAgentAction[]) {
  const [first, ...rest] = actions;
  if (!first || first.kind !== "action-call" || first.name !== "spawn") {
    throw new Error("Spawn blocks must start with `spawn`.");
  }

  return rest;
}

function isCreateStatementSource(source: string) {
  return /^create\s+[A-Za-z][A-Za-z0-9_-]*\s+/.test(source);
}

function parseRepeatHeader(source: string) {
  const match = source.match(/^repeat\s+(.+?)\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }

  const inner = match[1].trim();
  const rangeMatch = inner.match(/^([A-Za-z][A-Za-z0-9_-]*)\s+in\s+(.+)\.\.(.+)$/);
  if (rangeMatch) {
    return {
      index: rangeMatch[1],
      rangeStart: expression(rangeMatch[2]),
      rangeEnd: expression(rangeMatch[3]),
      bodySource: match[2].trim(),
    };
  }

  return {
    count: expression(inner),
    bodySource: match[2].trim(),
  };
}

function parseUpdateHeader(source: string) {
  const patchRegion = parsePatchRegionHeader(source);
  if (patchRegion) {
    return patchRegion;
  }

  const match = source.match(
    /^([A-Za-z][A-Za-z0-9_-]*)(?:\s+where\s+(?:\((.*)\)|([A-Za-z][A-Za-z0-9_-]*)))?\s*:(?!=)\s*(.*)$/,
  );

  if (!match) {
    return null;
  }

  return {
    headerSource: source.slice(0, source.length - match[4].length).trimEnd(),
    agentSet: match[1],
    where: match[2] ? expression(match[2]) : match[3] ? statePredicateExpression(match[3]) : undefined,
    bodySource: match[4].trim(),
  };
}

function parsePatchRegionHeader(source: string) {
  const match = source.match(
    /^patches\s+(in-radius|in-square)\s+(.+?)(?:\s+around\s*\((.*)\))?\s*:\s*(.*)$/,
  );

  if (!match) {
    return null;
  }

  const shape = match[1];
  const radius = match[2];
  const aroundClause = match[3];
  const bodySource = match[4].trim();

  if (aroundClause === undefined) {
    return {
      headerSource: source.slice(0, source.length - match[4].length).trimEnd(),
      agentSet: "patches",
      where: expression(`patch-${shape}(${radius})`),
      bodySource,
    };
  }

  const coordinates = splitTopLevelCommas(aroundClause);
  if (coordinates.length !== 2) {
    throw new Error(`Patch ${shape} regions use \`around (x, y)\`.`);
  }

  return {
    headerSource: source.slice(0, source.length - match[4].length).trimEnd(),
    agentSet: "patches",
    where: expression(`patch-${shape}(${radius}, ${coordinates[0]}, ${coordinates[1]})`),
    bodySource,
  };
}

function parseWhereHeader(source: string) {
  const match = source.match(/^where\s+(?:\((.*)\)|([A-Za-z][A-Za-z0-9_-]*))\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }

  return {
    condition: match[1] ? expression(match[1]) : statePredicateExpression(match[2]),
    bodySource: match[3].trim(),
  };
}

function parseOtherwiseHeader(source: string) {
  const match = source.match(/^otherwise\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }

  return {
    bodySource: match[1].trim(),
  };
}

// ============================================================
// Match arms
// ============================================================

interface ParsedMatchHeader {
  discriminators: string[];
  bodySource: string;
}

interface ParsedArmHeader {
  kind: "pattern";
  positions: ArmPosition[];
  bodySource: string;
}

interface ParsedOtherwiseArmHeader {
  kind: "otherwise";
  bodySource: string;
}

type ParsedArm = ParsedArmHeader | ParsedOtherwiseArmHeader;

type ArmPosition =
  | { kind: "wildcard" }
  | { kind: "literals"; values: string[] };

function parseMatchHeader(source: string): ParsedMatchHeader | null {
  const trimmed = source.trim();
  const match = trimmed.match(/^match\s+(.+?)\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }
  const discriminators = splitTopLevelCommas(match[1]).map((piece) => {
    const value = piece.trim();
    if (value.length === 0) {
      throw new Error("Empty discriminator in `match` header.");
    }
    return value;
  });
  if (discriminators.length === 0) {
    throw new Error("`match` requires at least one discriminator.");
  }
  return {
    discriminators,
    bodySource: match[2].trim(),
  };
}

function parseMatchArmHeader(source: string): ParsedArm | null {
  const trimmed = source.trim();
  const otherwise = trimmed.match(/^otherwise\s*:\s*(.*)$/);
  if (otherwise) {
    return { kind: "otherwise", bodySource: otherwise[1].trim() };
  }
  const match = trimmed.match(/^(.+?)\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }
  // Reject anything containing an assignment arrow, `(` (function call), or
  // starting with reserved keywords other than arm-pattern atoms.
  const patternText = match[1].trim();
  if (
    patternText.includes("<-") ||
    patternText.includes(":=") ||
    patternText.includes("(") ||
    patternText.startsWith("let ") ||
    patternText.startsWith("where ") ||
    patternText.startsWith("match ")
  ) {
    return null;
  }
  const positions = splitTopLevelCommas(patternText).map(parseArmPosition);
  return { kind: "pattern", positions, bodySource: match[2].trim() };
}

function parseArmPosition(text: string): ArmPosition {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("Empty position in match arm pattern.");
  }
  if (trimmed === "_") {
    return { kind: "wildcard" };
  }
  const values = trimmed.split("|").map((v) => v.trim());
  for (const v of values) {
    if (v.length === 0) {
      throw new Error(`Empty alternative in match arm pattern: "${trimmed}"`);
    }
    if (!/^([A-Za-z][A-Za-z0-9_-]*|true|false)$/.test(v)) {
      throw new Error(
        `Invalid arm position "${v}". Positions must be enum literals, true, false, or _.`,
      );
    }
  }
  return { kind: "literals", values };
}

function parseMatchArmsBlock(
  lines: StatementLine[],
  start: number,
  parentIndent: number,
): { arms: { header: ParsedArm; body: PetsAgentAction[] }[]; index: number } {
  const next = lines[start];
  if (!next || next.indent <= parentIndent) {
    throw new Error("Expected indented arms after `match`.");
  }
  const armIndent = next.indent;
  const arms: { header: ParsedArm; body: PetsAgentAction[] }[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < armIndent) {
      break;
    }
    if (line.indent > armIndent) {
      throw new Error(`Unexpected indentation in match arms: "${line.text}".`);
    }
    const armHeader = parseMatchArmHeader(line.text);
    if (!armHeader) {
      throw new Error(`Expected a match arm pattern: "${line.text}".`);
    }
    if (armHeader.bodySource.length > 0) {
      throw new Error("Expected a newline after match arm pattern.");
    }
    const child = parseRequiredChildBlock(lines, index, armIndent, "match arm");
    arms.push({ header: armHeader, body: child.items });
    index = child.index;
  }

  if (arms.length === 0) {
    throw new Error("`match` must have at least one arm.");
  }

  return { arms, index };
}

function lowerMatchArms(
  header: ParsedMatchHeader,
  arms: { header: ParsedArm; body: PetsAgentAction[] }[],
): PetsAgentAction[] {
  // Discriminators are inlined into each arm condition. The dispatch picks
  // exactly one arm per agent, so re-evaluating per arm check is cheap and
  // semantically equivalent to a one-shot evaluation (no prior arm has run).
  const discriminatorExprs = header.discriminators;

  // Validate arm shape against discriminator count, and that `otherwise` is last.
  for (let i = 0; i < arms.length; i += 1) {
    const arm = arms[i];
    if (arm.header.kind === "otherwise" && i !== arms.length - 1) {
      throw new Error("`otherwise:` must be the last arm in a `match`.");
    }
    if (arm.header.kind === "pattern" && arm.header.positions.length !== discriminatorExprs.length) {
      throw new Error(
        `Match arm has ${arm.header.positions.length} positions but the match has ${discriminatorExprs.length} discriminators.`,
      );
    }
  }

  return buildMatchCascade(arms, discriminatorExprs, 0);
}

function buildMatchCascade(
  arms: { header: ParsedArm; body: PetsAgentAction[] }[],
  discriminatorExprs: string[],
  armIndex: number,
): PetsAgentAction[] {
  if (armIndex >= arms.length) {
    return [];
  }
  const arm = arms[armIndex];
  if (arm.header.kind === "otherwise") {
    return arm.body;
  }
  const positions = arm.header.positions;
  const conditionParts: string[] = [];
  positions.forEach((pos, idx) => {
    if (pos.kind === "wildcard") return;
    const expr = discriminatorExprs[idx];
    const orParts = pos.values.map((v) => `${expr} = ${v}`);
    if (orParts.length === 1) {
      conditionParts.push(orParts[0]);
    } else {
      conditionParts.push(`(${orParts.join(" or ")})`);
    }
  });
  const tail = buildMatchCascade(arms, discriminatorExprs, armIndex + 1);
  if (conditionParts.length === 0) {
    // All wildcards — same as otherwise, no tail.
    return arm.body;
  }
  const condition =
    conditionParts.length === 1
      ? conditionParts[0]
      : conditionParts.join(" and ");
  const whereBlock: PetsWhereBlock = {
    kind: "where",
    condition: { source: condition },
    body: arm.body,
  };
  if (tail.length > 0) {
    whereBlock.otherwiseBody = tail;
  }
  return [whereBlock];
}

function parseInlineAgentMatchHeader(source: string) {
  // <agent-set> [where (...)|where state-name] match <discriminators>:
  const match = source.match(
    /^([A-Za-z][A-Za-z0-9_-]*)(?:\s+where\s+(?:\((.*?)\)|([A-Za-z][A-Za-z0-9_-]*)))?\s+match\s+(.+?)\s*:\s*(.*)$/,
  );
  if (!match) {
    return null;
  }
  const discriminators = splitTopLevelCommas(match[4]).map((piece) => {
    const value = piece.trim();
    if (value.length === 0) {
      throw new Error("Empty discriminator in `match` header.");
    }
    return value;
  });
  if (discriminators.length === 0) {
    throw new Error("`match` requires at least one discriminator.");
  }
  return {
    agentSet: match[1],
    where: match[2]
      ? expression(match[2])
      : match[3]
        ? statePredicateExpression(match[3])
        : undefined,
    discriminators,
    bodySource: match[5].trim(),
  };
}

function parseAgentAction(source: string): PetsAgentAction {
  if (source.startsWith("let ")) {
    return parseLetStatement(source);
  }

  if (/^decide\b/.test(source.trim())) {
    return parseDecideStatement(source);
  }

  if (/^scatter\b/.test(source.trim())) {
    return parseScatterStatement(source);
  }

  if (hasAssignArrow(source)) {
    return parseAssignment(source);
  }

  if (COMMAND_PATTERN.test(source)) {
    return parseCommand(source);
  }

  if (ZERO_ARG_COMMAND_PATTERN.test(source.trim())) {
    return parseZeroArgCommand(source);
  }

  const actionCall = parseActionCall(source);
  if (actionCall) {
    return actionCall;
  }

  return parseCommand(source);
}

/**
 * `scatter <spread>` places the agent uniformly in a square of side `spread`
 * centered on its current position; `scatter <spread> from <agent>` centers
 * on another agent, `scatter <spread> from <x>, <y>` on a point.
 */
function parseScatterStatement(source: string): PetsCommandStatement {
  const match = matchRequired(source.trim(), /^scatter\s+(.+)$/, "scatter statement");
  const rest = match[1].trim();
  const fromIndex = findTopLevelFrom(rest);
  const spreadSource = (fromIndex === -1 ? rest : rest.slice(0, fromIndex)).trim();

  if (spreadSource.length === 0) {
    throw new Error("scatter requires a spread, for example `scatter 4`.");
  }

  const args = [expression(spreadSource)];

  if (fromIndex !== -1) {
    const anchorSource = rest.slice(fromIndex + "from".length + 1).trim();
    const pieces = splitTopLevelCommas(anchorSource)
      .map((piece) => piece.trim())
      .filter(Boolean);

    if (pieces.length === 1) {
      args.push(expression(pieces[0]));
    } else if (pieces.length === 2) {
      args.push(expression(pieces[0]), expression(pieces[1]));
    } else {
      throw new Error(
        "scatter anchors are `from <agent>` or `from <x>, <y>`, for example `scatter 4 from one-of queens`.",
      );
    }
  }

  return {
    kind: "command",
    command: "scatter",
    args,
  };
}

/** Index of a bare ` from ` keyword outside parens, brackets, and strings. */
function findTopLevelFrom(source: string) {
  let depth = 0;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === quote && source[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

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
      source.startsWith("from", index) &&
      /\s/.test(source[index - 1] ?? "") &&
      /\s/.test(source[index + "from".length] ?? "")
    ) {
      return index;
    }
  }

  return -1;
}

function parseDecideStatement(source: string): PetsAgentAction {
  const match = matchRequired(
    source.trim(),
    /^decide\s+(.+)$/,
    "decide statement",
  );

  const fields = match[1].split(",").map((field) => field.trim());
  for (const field of fields) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(field)) {
      throw new Error(`Could not parse decide statement: ${source.trim()}`);
    }
  }

  return {
    kind: "decide",
    fields,
  };
}

function parseLetStatement(source: string): PetsAgentAction {
  const match = matchRequired(
    source.trim(),
    /^let\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s*:\s*(.+?))?\s*=\s*(.+)$/,
    "let statement",
  );

  if (match[1] === "mine") {
    throw new Error("`mine` is a reserved name and cannot be used as a local variable.");
  }

  return {
    kind: "let",
    name: match[1],
    type: match[2] ? parseType(match[2]) : undefined,
    expression: expression(match[3]),
  };
}

function parseCommand(source: string): PetsCommandStatement {
  const match = matchRequired(
    source.trim(),
    new RegExp(`^(${COMMAND_NAMES})\\s*\\((.*)\\)(?:\\s+over\\s+([A-Za-z][A-Za-z0-9_-]*))?$`),
    "command",
  );
  const args = splitTopLevelCommas(match[2])
    .map((arg) => arg.trim())
    .filter(Boolean)
    .map((arg) => expression(arg));

  const statement: PetsCommandStatement = {
    kind: "command",
    command: match[1] as PetsCommandStatement["command"],
    args,
  };

  if (match[3]) {
    if (statement.command !== "diffuse") {
      throw new Error(`\`over\` is only valid on \`diffuse\`, not \`${statement.command}\`.`);
    }
    statement.overBreed = match[3];
  }

  return statement;
}

function parseZeroArgCommand(source: string): PetsCommandStatement {
  const match = matchRequired(
    source.trim(),
    new RegExp(`^(${ZERO_ARG_COMMAND_NAMES})$`),
    "zero-arg command",
  );

  return {
    kind: "command",
    command: match[1] as PetsCommandStatement["command"],
    args: [],
  };
}

function parseActionCall(source: string): PetsAgentAction | null {
  const trimmed = source.trim();
  const parenMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*\((.*)\)$/);
  if (parenMatch) {
    const name = parenMatch[1];
    const argsText = parenMatch[2].trim();
    const args = splitTopLevelCommas(argsText)
      .map((arg) => arg.trim())
      .filter(Boolean)
      .map((arg) => expression(arg));
    return {
      kind: "action-call",
      name,
      args,
      hasParens: true,
    };
  }

  const noParenMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)$/);
  if (noParenMatch) {
    return {
      kind: "action-call",
      name: noParenMatch[1],
      hasParens: false,
    };
  }

  return null;
}

function parseAssignmentBlockHeader(source: string) {
  const match = source.trim().match(/^(.+?)\s*(?:<-|:=)\s*:\s*$/);
  if (!match) {
    return null;
  }

  return {
    target: match[1].trim(),
  };
}

function parseAssignmentFieldBlock(
  lines: StatementLine[],
  index: number,
  parentIndent: number,
  target: string,
): { items: PetsAssignment[]; index: number } {
  const next = lines[index + 1];
  if (!next || next.indent <= parentIndent) {
    throw new Error(`Expected an indented assignment block after "${lines[index].text}".`);
  }

  const items: PetsAssignment[] = [];
  const childIndent = next.indent;
  let childIndex = index + 1;

  while (childIndex < lines.length) {
    const line = lines[childIndex];
    if (line.indent < childIndent) {
      break;
    }

    if (line.indent > childIndent) {
      throw new Error(`Unexpected indentation before "${line.text}".`);
    }

    items.push(parseAssignmentFieldLine(target, line.text));
    childIndex += 1;
  }

  return { items, index: childIndex };
}

function parseAssignmentFieldLine(target: string, source: string): PetsAssignment {
  const match = matchRequired(
    source,
    /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/,
    "assignment field",
  );

  return {
    kind: "assignment",
    target: `${target}.${match[1]}`,
    expression: expression(match[2]),
  };
}

function parseAssignment(source: string): PetsAssignment {
  const match = matchRequired(
    source.trim(),
    /^(.+?)\s*(?:<-|:=)\s*(.+)$/,
    "assignment",
  );

  return {
    kind: "assignment",
    target: match[1].trim(),
    expression: expression(match[2]),
  };
}

function hasAssignArrow(text: string): boolean {
  return text.includes("<-") || text.includes(":=");
}

function expression(source: string): PetsExpression {
  return { source: source.trim() };
}

function statePredicateExpression(state: string): PetsExpression {
  return expression(state);
}

function findFirst(node: ConcreteNode, name: string): ConcreteNode | undefined {
  if (node.name === name) {
    return node;
  }

  for (const child of node.children) {
    const found = findFirst(child, name);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findAll(node: ConcreteNode, name: string): ConcreteNode[] {
  const matches: ConcreteNode[] = [];

  if (node.name === name) {
    matches.push(node);
  }

  for (const child of node.children) {
    matches.push(...findAll(child, name));
  }

  return matches;
}

function findAllOptional(node: ConcreteNode, sectionName: string, childName: string): ConcreteNode[] {
  const section = findFirst(node, sectionName);
  return section ? findAll(section, childName) : [];
}

function requireNode(node: ConcreteNode, name: string) {
  const found = findFirst(node, name);
  if (!found) {
    throw new Error(`Missing required ${name}.`);
  }
  return found;
}

function textOf(node: ConcreteNode, source: string) {
  return source.slice(node.from, node.to);
}

function oneLine(node: ConcreteNode, source: string) {
  return textOf(node, source).trim().replace(/\s+/g, " ");
}

function firstNonEmptyLine(source: string) {
  return source.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
}

function matchRequired(source: string, pattern: RegExp, label: string) {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Could not parse ${label}: ${source.trim()}`);
  }
  return match;
}

function splitTopLevelCommas(source: string) {
  return splitTopLevel(source, ",");
}

function splitTopLevel(source: string, delimiter: ",") {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
    } else if (character === delimiter && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}
