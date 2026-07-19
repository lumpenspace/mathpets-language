import type { PetsParseResult } from "./ast";
import { emitJavaScript } from "./emit-javascript";
import { parsePets } from "./parse";

export interface PetsCompileResult extends PetsParseResult {
  code: string | null;
}

export function compilePetsToJavaScript(source: string): PetsCompileResult {
  const parsed = parsePets(normalizePetsDocument(source));

  if (!parsed.model) {
    return {
      ...parsed,
      code: null,
    };
  }

  try {
    return { ...parsed, code: emitJavaScript(parsed.model) };
  } catch (error) {
    return {
      ...parsed,
      diagnostics: [
        ...parsed.diagnostics,
        { message: error instanceof Error ? error.message : String(error), from: 0, to: 0 },
      ],
      code: null,
    };
  }
}

/** Converts the authored metadata wrapper into the parser's model declaration. */
export function normalizePetsDocument(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const firstContent = lines.findIndex((line) => line.trim().length > 0 && !line.trim().startsWith("#"));
  if (firstContent < 0 || !/^model\s*:\s*$/.test(lines[firstContent].trim())) return source;

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

  return `model ${name}:\n\n${lines.slice(bodyStart).join("\n")}`;
}
