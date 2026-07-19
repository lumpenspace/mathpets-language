import type { PetsDiagnostic } from "./ast";

/**
 * Compile-time expansion for `teams:` (see docs/teams-design.md).
 *
 * Runs as a source-to-source preprocessor before the regular parse: the
 * `teams:` section and `per team` declarations are consumed here, and every
 * `create`/breed-update block that names a per-team template is stamped once
 * per team with the team's breed names, constants, and `enemy <breed>`
 * references substituted in. Downstream (grammar parse, buildModel, emit)
 * only ever sees plain breeds like `crimson-ants`.
 */

export interface TeamsExpansionResult {
  source: string;
  diagnostics: PetsDiagnostic[];
}

interface TeamDef {
  name: string;
  constants: Map<string, string>;
}

const SECTION_PATTERN =
  /^(model|defs|world|params|memory|monitors|patches|zones|pets|pets|links|setup|step|round|stop|brush|teams|agent)\b/;

const NAME = "[A-Za-z][A-Za-z0-9_-]*";
const BOUNDARY_BEFORE = "(?<![A-Za-z0-9_-])";
const BOUNDARY_AFTER = "(?![A-Za-z0-9_-])";

function indentSize(line: string) {
  const match = line.match(/^[ ]*/);
  return match ? match[0].length : 0;
}

function nameRef(name: string) {
  return new RegExp(`${BOUNDARY_BEFORE}${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${BOUNDARY_AFTER}`, "g");
}

/** Extracts a balanced `(...)` group starting at `start` (which must be `(`). */
function balancedGroup(text: string, start: number): string | null {
  if (text[start] !== "(") {
    return null;
  }
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

export function expandTeams(source: string): TeamsExpansionResult {
  const lines = source.split(/\r?\n/);
  const diagnostics: PetsDiagnostic[] = [];
  const fail = (message: string): TeamsExpansionResult => ({
    source,
    diagnostics: [...diagnostics, { message, from: 0, to: source.length }],
  });

  // ---- Pass 1: collect teams and per-team breed templates. ----
  const teams: TeamDef[] = [];
  const templates: string[] = [];
  let section: string | null = null;
  let currentTeam: TeamDef | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (indentSize(line) === 0) {
      const match = trimmed.match(SECTION_PATTERN);
      section = match ? match[1] : null;
      currentTeam = null;
      continue;
    }

    if (section === "teams") {
      const teamHeader = trimmed.match(new RegExp(`^(${NAME}):$`));
      if (indentSize(line) === 2 && teamHeader) {
        currentTeam = { name: teamHeader[1], constants: new Map() };
        teams.push(currentTeam);
        continue;
      }
      const constant = trimmed.match(new RegExp(`^(${NAME}):\\s*(.+)$`));
      if (currentTeam && indentSize(line) >= 4 && constant) {
        currentTeam.constants.set(constant[1], constant[2].trim());
        continue;
      }
      return fail(
        `Could not parse \`teams:\` line \`${trimmed}\` — teams use \`name:\` with indented \`constant: value\` lines.`,
      );
    }

    if (section === "pets" && indentSize(line) === 2) {
      const template = trimmed.match(new RegExp(`^(?:player\\s+|pet\\s+|pet\\s+)?(${NAME}) per team:$`));
      if (template) {
        templates.push(template[1]);
      }
    }
  }

  const usesPerTeam =
    templates.length > 0 || lines.some((line) => / per team:/.test(line) && indentSize(line) > 0);

  if (teams.length === 0) {
    if (usesPerTeam) {
      return fail("`per team` declarations need a top-level `teams:` section.");
    }
    return { source, diagnostics: [] };
  }
  if (templates.length === 0) {
    return fail("A `teams:` section needs at least one `per team` breed in `pets:`.");
  }

  const stamped = (team: TeamDef, template: string) => `${team.name}-${template}`;

  // ---- Substitution for one team applied to a chunk of lines. ----
  const substitute = (text: string, team: TeamDef): string | null => {
    let output = text;
    const enemies = teams.filter((candidate) => candidate !== team);

    for (const template of templates) {
      // count-in-radius(enemy X, ...) → summed per enemy team.
      const cir = new RegExp(`count-in-radius\\(\\s*enemy\\s+${template}${BOUNDARY_AFTER}\\s*,`);
      for (let match = output.match(cir); match; match = output.match(cir)) {
        const open = output.indexOf("count-in-radius", match.index!) + "count-in-radius".length;
        const group = balancedGroup(output, open);
        if (!group) return null;
        const rest = group.slice(group.indexOf(",") + 1, -1);
        const expanded = enemies
          .map((enemy) => `count-in-radius(${stamped(enemy, template)},${rest})`)
          .join(" + ");
        output = output.slice(0, match.index!) + `(${expanded})` + output.slice(open + group.length);
      }

      // count/any enemy X [where (...)] → summed / or-ed per enemy team.
      for (const keyword of ["count", "any"] as const) {
        const pattern = new RegExp(`${BOUNDARY_BEFORE}${keyword}\\s+enemy\\s+${template}${BOUNDARY_AFTER}`);
        for (let match = output.match(pattern); match; match = output.match(pattern)) {
          const afterIndex = match.index! + match[0].length;
          const whereMatch = output.slice(afterIndex).match(/^\s+where\s*/);
          let suffix = "";
          let consumed = afterIndex;
          if (whereMatch) {
            const group = balancedGroup(output, afterIndex + whereMatch[0].length);
            if (!group) return null;
            suffix = ` where ${group}`;
            consumed = afterIndex + whereMatch[0].length + group.length;
          }
          const joiner = keyword === "count" ? " + " : " or ";
          const expanded = enemies
            .map((enemy) => `${keyword} ${stamped(enemy, template)}${suffix}`)
            .join(joiner);
          output = output.slice(0, match.index!) + `(${expanded})` + output.slice(consumed);
        }
      }
    }

    // Any remaining `enemy X` for a template is unsupported in v1.
    for (const template of templates) {
      if (new RegExp(`${BOUNDARY_BEFORE}enemy\\s+${template}${BOUNDARY_AFTER}`).test(output)) {
        return null;
      }
    }

    for (const template of templates) {
      output = output.replace(nameRef(template), stamped(team, template));
    }
    for (const [name, value] of team.constants) {
      output = output.replace(nameRef(name), `(${value})`);
    }

    return output;
  };

  /**
   * Expands a statement block whose first line carries an `enemy <template>`
   * reference outside the supported expression forms (count-in-radius, count,
   * any). The line and its indented sub-block are stamped once per enemy
   * team, with `let` locals declared inside suffixed by the enemy team name
   * so the copies don't collide:
   *
   *     let prey = one-of enemy ants here      →  let prey-azure = one-of azure-ants here
   *     where (prey):                              where (prey-azure):
   *       kill(prey)                                 kill(prey-azure)
   *                                              let prey-gold = ...
   */
  const expandEnemyBlock = (block: string[], team: TeamDef): string[] | null => {
    const result: string[] = [];
    const enemies = teams.filter((candidate) => candidate !== team);
    const declaredLets = block
      .map((line) => line.match(new RegExp(`^\\s*let\\s+(${NAME})\\s*=`)))
      .flatMap((match) => (match ? [match[1]] : []));

    for (const enemy of enemies) {
      for (const line of block) {
        let expanded = line;
        for (const template of templates) {
          expanded = expanded.replace(
            new RegExp(`${BOUNDARY_BEFORE}enemy\\s+${template}${BOUNDARY_AFTER}`, "g"),
            stamped(enemy, template),
          );
        }
        for (const local of declaredLets) {
          expanded = expanded.replace(
            new RegExp(`${BOUNDARY_BEFORE}${local}${BOUNDARY_AFTER}`, "g"),
            `${local}-${enemy.name}`,
          );
        }
        const substituted = substitute(expanded, team);
        if (substituted === null) return null;
        result.push(substituted);
      }
    }

    return result;
  };

  const hasBareEnemyReference = (line: string) =>
    templates.some((template) =>
      new RegExp(`${BOUNDARY_BEFORE}enemy\\s+${template}${BOUNDARY_AFTER}`).test(line) &&
      substitute(line, teams[0]) === null,
    );

  /** Stamp one chunk (header + body lines) for every team. */
  const stampChunk = (chunk: string[]): string[] | null => {
    const result: string[] = [];
    for (const team of teams) {
      let index = 0;
      while (index < chunk.length) {
        const line = chunk[index];

        if (hasBareEnemyReference(line)) {
          // The expansion spans to the end of the enclosing block (same
          // indent and deeper): a `let` bound to an enemy set is used by the
          // sibling statements that follow it, and each enemy team needs its
          // own copy of those uses.
          const blockIndent = indentSize(line);
          const block = [line];
          index += 1;
          while (index < chunk.length && indentSize(chunk[index]) >= blockIndent) {
            block.push(chunk[index]);
            index += 1;
          }
          const expanded = expandEnemyBlock(block, team);
          if (expanded === null) return null;
          result.push(...expanded);
          continue;
        }

        const substituted = substitute(line, team);
        if (substituted === null) return null;
        result.push(substituted);
        index += 1;
      }
    }
    return result;
  };

  const templateHeader = new RegExp(`^(${NAME})(\\s+where\\s+.*)?:$`);
  const templateCreate = new RegExp(`^create\\s+(${NAME})${BOUNDARY_AFTER}`);

  // ---- Pass 2: rebuild the source. ----
  const output: string[] = [];
  section = null;
  let index = 0;

  const takeChunk = (headerIndent: number) => {
    const chunk = [lines[index]];
    index += 1;
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim().length > 0 && indentSize(line) <= headerIndent) break;
      if (line.trim().length === 0) {
        // Blank lines end a chunk only when the block is over; peek ahead.
        const next = lines.slice(index + 1).find((candidate) => candidate.trim().length > 0);
        if (!next || indentSize(next) <= headerIndent) break;
      }
      chunk.push(line);
      index += 1;
    }
    while (chunk.length > 0 && chunk[chunk.length - 1].trim().length === 0) {
      chunk.pop();
    }
    return chunk;
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = indentSize(line);

    if (trimmed.length > 0 && indent === 0) {
      const match = trimmed.match(SECTION_PATTERN);
      section = match ? match[1] : null;
      if (section === "teams") {
        takeChunk(0);
        continue;
      }
      output.push(line);
      index += 1;
      continue;
    }

    if (section === "pets" && indent === 2) {
      const template = trimmed.match(new RegExp(`^((?:player\\s+|pet\\s+|pet\\s+)?)(${NAME}) per team:$`));
      if (template && templates.includes(template[2])) {
        const chunk = takeChunk(indent);
        for (const team of teams) {
          const header = `  ${template[1]}${stamped(team, template[2])}:`;
          output.push(header);
          for (const bodyLine of chunk.slice(1)) {
            const substituted = substitute(bodyLine, team);
            if (substituted === null) {
              return fail(`Unsupported \`enemy\` reference while stamping \`${template[2]}\` for team \`${team.name}\`.`);
            }
            output.push(substituted);
          }
        }
        continue;
      }
    }

    if (section === "monitors" && indent === 2) {
      const monitor = trimmed.match(new RegExp(`^(${NAME}) per team:\\s*(.+)$`));
      if (monitor) {
        for (const team of teams) {
          const substituted = substitute(monitor[2], team);
          if (substituted === null) {
            return fail(`Unsupported \`enemy\` reference in per-team monitor \`${monitor[1]}\`.`);
          }
          output.push(`  ${team.name}-${monitor[1]}: ${substituted}`);
        }
        index += 1;
        continue;
      }
    }

    if ((section === "setup" || section === "step" || section === "round" || section === "brush") && trimmed.length > 0) {
      const header = trimmed.match(templateHeader);
      const create = trimmed.match(templateCreate);
      const templateName = header?.[1] ?? create?.[1];
      if (templateName && templates.includes(templateName)) {
        const chunk = takeChunk(indent);
        const stampedChunk = stampChunk(chunk);
        if (stampedChunk === null) {
          return fail(
            `Unsupported \`enemy\` reference while stamping \`${templateName}\` — \`enemy <breed>\` works in count-in-radius, count, any, and statement blocks (expanded once per enemy team).`,
          );
        }
        output.push(...stampedChunk);
        continue;
      }
    }

    output.push(line);
    index += 1;
  }

  return { source: output.join("\n"), diagnostics };
}
