/**
 * Public entry point for the MathPets language package.
 *
 * The package owns the grammar-backed parser, AST conversion, and emitters that
 * target runtime backends such as the current JavaScript model API.
 */
export * from "./ast";
export * from "./agentset-expression";
export * from "./compile";
export * from "./emit-javascript";
export * from "./parse";
export * from "./teams";
export { parser as petsParser } from "./generated/parser";
