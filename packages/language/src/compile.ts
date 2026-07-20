import type { PetsParseResult } from "./ast";
import { emitJavaScript } from "./emit-javascript";
import { parsePets } from "./parse";

export interface PetsCompileResult extends PetsParseResult {
  code: string | null;
}

export function compilePetsToJavaScript(source: string): PetsCompileResult {
  const normalized = normalizePetsDocumentWithMap(source);
  const parsed = parsePets(normalized.source);
  const diagnostics = parsed.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    from: normalized.mapOffset(diagnostic.from),
    to: normalized.mapOffset(diagnostic.to),
  }));

  if (!parsed.model) {
    return {
      ...parsed,
      diagnostics,
      code: null,
    };
  }

  try {
    return { ...parsed, diagnostics, code: emitJavaScript(parsed.model) };
  } catch (error) {
    return {
      ...parsed,
      diagnostics: [
        ...diagnostics,
        { message: error instanceof Error ? error.message : String(error), from: 0, to: 0 },
      ],
      code: null,
    };
  }
}

/** Converts the authored metadata wrapper into the parser's model declaration. */
export function normalizePetsDocument(source: string): string {
  return normalizePetsDocumentWithMap(source).source;
}

function normalizePetsDocumentWithMap(source: string) {
  const lines = source.split(/\r\n?|\n/);
  const firstContent = lines.findIndex((line) => line.trim().length > 0 && !line.trim().startsWith("#"));
  if (firstContent < 0 || !/^model\s*:\s*$/.test(lines[firstContent].trim())) {
    return { source, mapOffset: (offset: number) => offset };
  }

  let name = "Untitled";
  let bodyStart = lines.length;
  for (let index = firstContent + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*(?:\s+[^:]*)?\s*:\s*$/.test(line) && !/^\s/.test(line)) {
      bodyStart = index;
      break;
    }
    const nameMatch = line.match(/^\s+name\s*:\s*(.+?)\s*$/);
    if (nameMatch) name = nameMatch[1].replace(/^['"]|['"]$/g, "");
  }

  const normalizedSource = `model ${name}:\n\n${lines.slice(bodyStart).join("\n")}`;
  const originalLineStarts = lineStarts(source);
  const normalizedLineStarts = lineStarts(normalizedSource);

  return {
    source: normalizedSource,
    mapOffset(offset: number) {
      const safeOffset = Math.max(0, Math.min(normalizedSource.length, offset));
      const normalizedLine = lineAtOffset(normalizedLineStarts, safeOffset);
      if (normalizedLine < 2 || bodyStart >= lines.length) return originalLineStarts[firstContent] ?? 0;
      const originalLine = Math.min(lines.length - 1, bodyStart + normalizedLine - 2);
      const column = safeOffset - normalizedLineStarts[normalizedLine];
      return (originalLineStarts[originalLine] ?? source.length) + Math.min(column, lines[originalLine].length);
    },
  };
}

function lineStarts(source: string) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineAtOffset(starts: number[], offset: number) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return low;
}
