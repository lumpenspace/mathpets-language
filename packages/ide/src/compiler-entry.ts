import { compilePetsToJavaScript } from "@pets/language";
import { defineModel } from "@pets/model-api";

export { compilePetsToJavaScript };

export function instantiatePetsModel(source: string) {
  const compiled = compilePetsToJavaScript(source);
  if (!compiled.code || compiled.diagnostics.length > 0) {
    return { model: null, diagnostics: compiled.diagnostics };
  }

  const executable = compiled.code
    .replace(/^import\s+\{\s*defineModel\s*\}\s+from\s+["']@pets\/model-api["'];?\s*/m, "")
    .replace(/\bexport\s+function\s+createModel\b/, "function createModel");
  const createModel = new Function("defineModel", `${executable}\nreturn createModel;`)(defineModel);
  const model = createModel();
  model.restart();
  return { model, diagnostics: [] };
}
