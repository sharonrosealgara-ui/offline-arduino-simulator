import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/renderer/state/store';
import type { PinEdge } from '@offline-arduino/contracts/simulator';

function reset(): void {
  useAppStore.getState().actions.clearLogic();
  useAppStore.getState().actions.setLogicCapturing(true);
}

describe('logic store slice', () => {
  beforeEach(reset);

  it('appends ordered edge batches grouped by pin', () => {
    const batch: PinEdge[] = [
      { boardPin: 'D13', cycle: 100, logic: 1 },
      { boardPin: 'D1', cycle: 120, logic: 0 },
      { boardPin: 'D13', cycle: 200, logic: 0 },
    ];
    useAppStore.getState().actions.recordLogicEdges(batch);
    const logic = useAppStore.getState().logic;
    expect(logic.edgesByPin.D13.map((e) => e.cycle)).toEqual([100, 200]);
    expect(logic.edgesByPin.D13.map((e) => e.level)).toEqual([1, 0]);
    expect(logic.edgesByPin.D1).toHaveLength(1);
    expect(logic.firstCycle).toBe(100);
    expect(logic.lastCycle).toBe(200);
  });

  it('clear resets edges, cycle range, and truncation but preserves capturing intent', () => {
    useAppStore.getState().actions.recordLogicEdges([{ boardPin: 'D13', cycle: 5, logic: 1 }]);
    useAppStore.getState().actions.markLogicTruncated();
    useAppStore.getState().actions.setLogicCapturing(false);
    useAppStore.getState().actions.clearLogic();
    const logic = useAppStore.getState().logic;
    expect(logic.edgesByPin).toEqual({});
    expect(logic.firstCycle).toBe(0);
    expect(logic.lastCycle).toBe(0);
    expect(logic.truncated).toBe(false);
    expect(logic.capturing).toBe(false); // intent preserved across clear
  });

  it('markLogicTruncated is idempotent and sets the flag', () => {
    expect(useAppStore.getState().logic.truncated).toBe(false);
    useAppStore.getState().actions.markLogicTruncated();
    expect(useAppStore.getState().logic.truncated).toBe(true);
    const before = useAppStore.getState().logic;
    useAppStore.getState().actions.markLogicTruncated();
    expect(useAppStore.getState().logic).toBe(before); // no-op returns same ref
  });

  it('an empty batch does not mutate state', () => {
    const before = useAppStore.getState().logic;
    useAppStore.getState().actions.recordLogicEdges([]);
    expect(useAppStore.getState().logic).toBe(before);
  });
});
