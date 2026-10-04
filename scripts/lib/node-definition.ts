/**
 * Compatibility shim: the definition language moved into `@xiranite/node-definitions` (ADR-0069) so the
 * product layer and the development gates share one implementation. The gates keep importing this path.
 */
export * from "../../packages/node-definitions/src/contract.ts"
