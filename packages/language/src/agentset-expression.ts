export type PetsAgentSetExpression =
  | { kind: "named"; name: string }
  | { kind: "other"; source: PetsAgentSetExpression }
  | { kind: "link-neighbors"; breed?: string }
  | { kind: "links-with"; breed?: string }
  | { kind: "in-link-neighbors"; breed?: string }
  | { kind: "out-link-neighbors"; breed?: string }
  | { kind: "in-links"; breed?: string }
  | { kind: "out-links"; breed?: string }
  | { kind: "n-of"; count: string; source: PetsAgentSetExpression }
  | { kind: "here"; source: PetsAgentSetExpression }
  | { kind: "where"; source: PetsAgentSetExpression; condition: string; state?: string };

export type PetsAgentSetReporterExpression =
  | { kind: "one-of"; source: PetsAgentSetExpression };

export function parseAgentSetExpression(source: string): PetsAgentSetExpression | null {
  const trimmed = source.trim();

  const whereMatch = trimmed.match(/^(.+?)\s+where\s+(?:\((.*)\)|([A-Za-z][A-Za-z0-9_-]*))$/);
  if (whereMatch) {
    const query = parseAgentSetExpression(whereMatch[1]);
    if (query) {
      return {
        kind: "where",
        source: query,
        condition: whereMatch[2] || "",
        state: whereMatch[3],
      };
    }
  }

  const hereMatch = trimmed.match(/^(.+?)\s+here$/);
  if (hereMatch) {
    const query = parseAgentSetExpression(hereMatch[1]);
    // Not an agentset prefix (e.g. `any sheep here` arriving whole) — decline
    // and let the caller's reporter handling take the expression apart.
    if (!query) {
      return null;
    }

    return {
      kind: "here",
      source: query,
    };
  }

  const nOfMatch = trimmed.match(/^n-of\s*\((.*)\)$/);
  if (nOfMatch) {
    const args = splitTopLevelCommas(nOfMatch[1]);
    if (args.length !== 2) {
      throw new Error("n-of requires a count and agentset.");
    }

    const query = parseAgentSetExpression(args[1]);
    if (!query) {
      throw new Error(`Expected an agentset expression, received "${args[1].trim()}".`);
    }

    return {
      kind: "n-of",
      count: args[0],
      source: query,
    };
  }

  const otherMatch = trimmed.match(/^other\s+(.+)$/);
  if (otherMatch) {
    const query = parseAgentSetExpression(otherMatch[1]);
    if (!query) {
      throw new Error(`Expected an agentset expression after other.`);
    }

    return {
      kind: "other",
      source: query,
    };
  }

  if (/^link-neighbors\s*\(\s*\)$/.test(trimmed)) {
    throw new Error("`link-neighbors()` was renamed — use `link-neighbors`.");
  }
  if (trimmed === "link-neighbors") {
    return {
      kind: "link-neighbors",
    };
  }

  const linkNeighborsMatch = trimmed.match(/^link-neighbors\s*\(([^()]*)\)$/);
  if (linkNeighborsMatch) {
    const args = splitTopLevelCommas(linkNeighborsMatch[1]);
    if (args.length > 1) {
      throw new Error("link-neighbors takes zero or one link breed.");
    }

    return {
      kind: "link-neighbors",
      breed: args[0],
    };
  }

  const linksWithMatch = trimmed.match(/^links-with\s*\(([^()]*)\)$/);
  if (linksWithMatch) {
    const args = splitTopLevelCommas(linksWithMatch[1]);
    if (args.length > 1) {
      throw new Error("links-with takes zero or one link breed.");
    }

    return {
      kind: "links-with",
      breed: args[0],
    };
  }

  const inLinkNeighborsMatch = trimmed.match(/^in-link-neighbors\s*\(([^()]*)\)$/);
  if (inLinkNeighborsMatch) {
    const args = splitTopLevelCommas(inLinkNeighborsMatch[1]);
    if (args.length > 1) {
      throw new Error("in-link-neighbors takes zero or one link breed.");
    }

    return {
      kind: "in-link-neighbors",
      breed: args[0],
    };
  }

  const outLinkNeighborsMatch = trimmed.match(/^out-link-neighbors\s*\(([^()]*)\)$/);
  if (outLinkNeighborsMatch) {
    const args = splitTopLevelCommas(outLinkNeighborsMatch[1]);
    if (args.length > 1) {
      throw new Error("out-link-neighbors takes zero or one link breed.");
    }

    return {
      kind: "out-link-neighbors",
      breed: args[0],
    };
  }

  const inLinksMatch = trimmed.match(/^in-links\s*\(([^()]*)\)$/);
  if (inLinksMatch) {
    const args = splitTopLevelCommas(inLinksMatch[1]);
    if (args.length > 1) {
      throw new Error("in-links takes zero or one link breed.");
    }

    return {
      kind: "in-links",
      breed: args[0],
    };
  }

  const outLinksMatch = trimmed.match(/^out-links\s*\(([^()]*)\)$/);
  if (outLinksMatch) {
    const args = splitTopLevelCommas(outLinksMatch[1]);
    if (args.length > 1) {
      throw new Error("out-links takes zero or one link breed.");
    }

    return {
      kind: "out-links",
      breed: args[0],
    };
  }

  const namedMatch = trimmed.match(/^(patches|pets|pets|turtles|links|[A-Za-z][A-Za-z0-9_-]*)$/);
  if (namedMatch) {
    return {
      kind: "named",
      name: namedMatch[1],
    };
  }

  return null;
}

export function parseAgentSetReporterExpression(
  source: string,
): PetsAgentSetReporterExpression | null {
  const trimmed = source.trim();
  const oneOfMatch = trimmed.match(/^one-of\s+(.+)$/);
  if (!oneOfMatch) {
    return null;
  }

  const query = parseAgentSetExpression(oneOfMatch[1]);
  if (!query) {
    throw new Error(`Expected an agentset expression after one-of.`);
  }

  return {
    kind: "one-of",
    source: query,
  };
}

function splitTopLevelCommas(source: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}
