/**
 * @offline-arduino/simulator — AVR8js worker runner, netlist compiler, bounded
 * electrical solver, and component runtime models.
 *
 * NOTE: `simulator.worker.ts` is NOT re-exported here. It is a worker entry point
 * loaded directly via `new Worker(new URL('.../simulator.worker.ts', import.meta.url))`
 * (see apps/desktop/src/renderer/simulation/simulation-client.ts) and must never be
 * imported into the main thread bundle.
 */
export * from './intel-hex';
export * from './netlist-compiler';
export * from './electrical-solver';
export * from './circuit-runtime';
export * from './board/uno';
export * from './circuit-model/component-registry';
export * from './components/led-runtime';
export * from './components/pushbutton-runtime';
export * from './components/potentiometer-runtime';
export * from './components/hd44780-runtime';
export * from './components/servo-runtime';
