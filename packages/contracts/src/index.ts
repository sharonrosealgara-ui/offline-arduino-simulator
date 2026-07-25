/**
 * @offline-arduino/contracts — dependency-free shared DTOs and Zod schemas.
 *
 * Import subpaths directly (e.g. `@offline-arduino/contracts/simulator`) in hot paths
 * such as the worker, or use this barrel for convenience in the renderer/main.
 */
export * from './board-profiles';
export * from './compiler';
export * from './compiler-schema';
export * from './simulator';
export * from './circuit';
export * from './serial';
export * from './examples';
export * from './help';
