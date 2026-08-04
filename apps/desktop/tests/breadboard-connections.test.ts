/**
 * What a hole is joined to, and whether anything is in it.
 *
 * The test that matters most for correctness is the one about identity: `A1` is a hole on
 * this board, a hole on the OTHER board, and the Uno's analog pin 1. A wire into any one of
 * them must say nothing about the other two. That is not a hypothetical — the strings really
 * do collide, and a lookup by bare terminal id would silently mark holes occupied that are
 * not.
 */
import { describe, expect, it } from 'vitest';
import { createBreadboardModel } from '@offline-arduino/contracts/breadboard';
import type { CircuitWire } from '@offline-arduino/contracts/circuit';
import {
  connectedGroupDescription,
  freeHolesInSameGroup,
  groupIdForHole,
  holeAnnouncement,
  holesAreConnected,
  holesInSameGroup,
  isHoleOccupied,
  occupiedHoles,
} from '../src/renderer/app/circuit/breadboard-connections';

const model = createBreadboardModel();

let seq = 0;
const wire = (from: [string, string], to: [string, string]): CircuitWire =>
  ({
    id: `w${(seq += 1)}`,
    from: { componentId: from[0], terminalId: from[1] },
    to: { componentId: to[0], terminalId: to[1] },
    colorRole: 'signal-yellow',
    waypoints: [],
  }) as CircuitWire;

describe('group membership matches the canonical model', () => {
  it('agrees with the canonical group for every one of the 400 holes', () => {
    for (const hole of model.holes) {
      expect(groupIdForHole(hole.id)).toBe(hole.groupId);
      const group = model.groups.find((g) => g.id === hole.groupId)!;
      expect(holesInSameGroup(hole.id)).toEqual(group.holeIds);
    }
  });

  it('joins the five holes of a strip and nothing else', () => {
    expect(holesInSameGroup('A5')).toEqual(['A5', 'B5', 'C5', 'D5', 'E5']);
    expect(holesInSameGroup('F5')).toEqual(['F5', 'G5', 'H5', 'I5', 'J5']);
    expect(holesAreConnected('A5', 'E5')).toBe(true);
    expect(holesAreConnected('A5', 'A6')).toBe(false);
  });

  it('never joins across the centre separation, for any column', () => {
    for (let column = 1; column <= 30; column += 1) {
      for (const lower of ['A', 'B', 'C', 'D', 'E']) {
        for (const upper of ['F', 'G', 'H', 'I', 'J']) {
          const pair = `${lower}${column}/${upper}${column}`;
          expect(`${pair}:${holesAreConnected(`${lower}${column}`, `${upper}${column}`)}`).toBe(`${pair}:false`);
        }
      }
    }
  });

  it('joins all 25 holes of each rail and keeps the four rails apart', () => {
    for (const prefix of ['TP', 'TN', 'BP', 'BN']) {
      const members = holesInSameGroup(`${prefix}1`);
      expect(members).toHaveLength(25);
      expect(members).toEqual(Array.from({ length: 25 }, (_, i) => `${prefix}${i + 1}`));
      expect(holesAreConnected(`${prefix}1`, `${prefix}25`)).toBe(true);
    }
    const rails = ['TP1', 'TN1', 'BP1', 'BN1'];
    for (let i = 0; i < rails.length; i += 1) {
      for (let j = i + 1; j < rails.length; j += 1) {
        expect(`${rails[i]}/${rails[j]}`).toBe(`${rails[i]}/${rails[j]}`);
        expect(holesAreConnected(rails[i], rails[j])).toBe(false);
      }
    }
  });

  it('keeps rails and strips apart', () => {
    expect(holesAreConnected('TP1', 'A1')).toBe(false);
    expect(holesAreConnected('BN25', 'J30')).toBe(false);
  });

  it('returns nothing for something that is not a hole', () => {
    expect(groupIdForHole('K1')).toBeUndefined();
    expect(holesInSameGroup('K1')).toEqual([]);
    expect(holesAreConnected('K1', 'A1')).toBe(false);
  });
});

describe('descriptions a beginner can act on', () => {
  it('names the four partners of a strip hole', () => {
    expect(connectedGroupDescription('A5')).toBe('A5 — connected to B5, C5, D5 and E5');
    expect(connectedGroupDescription('F5')).toBe('F5 — connected to G5, H5, I5 and J5');
    expect(connectedGroupDescription('C17')).toBe('C17 — connected to A17, B17, D17 and E17');
  });

  it('names the run for a rail rather than listing twenty-four holes', () => {
    expect(connectedGroupDescription('TP1')).toBe('TP1 — connected along the top positive rail');
    expect(connectedGroupDescription('TN25')).toBe('TN25 — connected along the top negative rail');
    expect(connectedGroupDescription('BP13')).toBe('BP13 — connected along the bottom positive rail');
    expect(connectedGroupDescription('BN25')).toBe('BN25 — connected along the bottom negative rail');
  });

  it('distinguishes all four rails from one another', () => {
    const descriptions = ['TP1', 'TN1', 'BP1', 'BN1'].map((id) => connectedGroupDescription(id)!);
    expect(new Set(descriptions).size).toBe(4);
  });

  it('always leads with the exact hole id', () => {
    for (const id of ['A1', 'J30', 'TP7', 'BN20']) {
      expect(connectedGroupDescription(id)!.startsWith(`${id} — `)).toBe(true);
    }
  });

  it('does not replace the explanation with the stable group id', () => {
    const description = connectedGroupDescription('A5')!;
    expect(description).not.toContain('strip:');
    expect(groupIdForHole('A5')).toBe('strip:5:AE');
  });

  it('gives nothing for a non-hole', () => {
    expect(connectedGroupDescription('K1')).toBeUndefined();
  });
});

describe('occupancy is derived, and qualified by component', () => {
  it('reads both ends of every wire', () => {
    const wires = [wire(['uno1', 'D13'], ['bb1', 'A5']), wire(['bb1', 'J30'], ['led1', 'anode'])];
    expect(occupiedHoles(wires, 'bb1')).toEqual(new Set(['A5', 'J30']));
  });

  it('does not let the Uno’s A1 mark the breadboard’s A1 occupied', () => {
    const wires = [wire(['uno1', 'A1'], ['led1', 'anode'])];
    expect(occupiedHoles(wires, 'bb1').has('A1')).toBe(false);
    expect(isHoleOccupied(wires, { componentId: 'bb1', terminalId: 'A1' })).toBe(false);
  });

  it('does not let one breadboard mark another one occupied', () => {
    const wires = [wire(['bb2', 'A1'], ['uno1', 'D2'])];
    expect(occupiedHoles(wires, 'bb1').has('A1')).toBe(false);
    expect(occupiedHoles(wires, 'bb2').has('A1')).toBe(true);
  });

  it('counts a hole claimed by a wire that is still being drawn', () => {
    const pending = { componentId: 'bb1', terminalId: 'C9' };
    expect(isHoleOccupied([], { componentId: 'bb1', terminalId: 'C9' }, pending)).toBe(true);
    expect(isHoleOccupied([], { componentId: 'bb1', terminalId: 'C10' }, pending)).toBe(false);
    // ...and only on the board it was started from.
    expect(isHoleOccupied([], { componentId: 'bb2', terminalId: 'C9' }, pending)).toBe(false);
  });

  it('frees the hole as soon as the wire is gone', () => {
    const wires = [wire(['uno1', 'D13'], ['bb1', 'A5'])];
    expect(isHoleOccupied(wires, { componentId: 'bb1', terminalId: 'A5' })).toBe(true);
    expect(isHoleOccupied([], { componentId: 'bb1', terminalId: 'A5' })).toBe(false);
  });

  it('reports nothing occupied on an empty circuit', () => {
    expect(occupiedHoles([], 'bb1').size).toBe(0);
  });
});

describe('alternative holes are equivalent, free and canonically ordered', () => {
  it('offers the rest of the same group, in canonical order', () => {
    const wires = [wire(['uno1', 'D13'], ['bb1', 'A5'])];
    expect(freeHolesInSameGroup(wires, { componentId: 'bb1', terminalId: 'A5' })).toEqual([
      'B5', 'C5', 'D5', 'E5',
    ]);
  });

  it('never offers a hole from another group or across the separation', () => {
    const alternatives = freeHolesInSameGroup([], { componentId: 'bb1', terminalId: 'A5' });
    for (const id of alternatives) {
      expect(`${id}:${holesAreConnected('A5', id)}`).toBe(`${id}:true`);
      expect(['F5', 'G5', 'H5', 'I5', 'J5']).not.toContain(id);
    }
  });

  it('omits holes that are already taken', () => {
    const wires = [wire(['uno1', 'D13'], ['bb1', 'A5']), wire(['uno1', 'D12'], ['bb1', 'C5'])];
    expect(freeHolesInSameGroup(wires, { componentId: 'bb1', terminalId: 'A5' })).toEqual(['B5', 'D5', 'E5']);
  });

  it('returns nothing when the whole group is full', () => {
    const wires = ['A5', 'B5', 'C5', 'D5', 'E5'].map((id) => wire(['uno1', `D${id}`], ['bb1', id]));
    expect(freeHolesInSameGroup(wires, { componentId: 'bb1', terminalId: 'A5' })).toEqual([]);
  });

  it('offers rail alternatives from the same rail only', () => {
    const alternatives = freeHolesInSameGroup([], { componentId: 'bb1', terminalId: 'TP1' });
    expect(alternatives).toEqual(['TP2', 'TP3', 'TP4', 'TP5']);
    expect(alternatives.every((id) => id.startsWith('TP'))).toBe(true);
  });
});

describe('the announcement carries all three facts', () => {
  it('states hole, connections and availability', () => {
    const announcement = holeAnnouncement([], { componentId: 'bb1', terminalId: 'A5' });
    expect(announcement).toContain('A5');
    expect(announcement).toContain('connected to B5, C5, D5 and E5');
    expect(announcement).toContain('Available');
  });

  it('says occupied when something is in the hole', () => {
    const wires = [wire(['uno1', 'D13'], ['bb1', 'A5'])];
    const announcement = holeAnnouncement(wires, { componentId: 'bb1', terminalId: 'A5' });
    expect(announcement).toContain('Occupied');
    expect(announcement).not.toContain('Available');
  });

  it('describes a rail hole by its run', () => {
    expect(holeAnnouncement([], { componentId: 'bb1', terminalId: 'BN9' })).toContain(
      'connected along the bottom negative rail',
    );
  });
});
