/* eslint-disable */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Inspector } from './Inspector';
import { useAppStore } from '../../state/store';
import { simulationClient } from '../../simulation/simulation-client';

describe('Inspector interactive controls', () => {
  beforeEach(() => {
    // reset store to default with a fresh circuit and no selection
    useAppStore.setState((s) => ({
      circuit: { ...s.circuit, components: [{ id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} }], selectedIds: [] },
      simulation: { ...s.simulation, components: {} },
    }));
    // stub the setControl method
    (simulationClient as any).setControl = vi.fn();
  });

  it('pushbutton inspector button responds to Space/Enter and suppresses repeats', () => {
    // Arrange: add a pushbutton and select it
    useAppStore.setState((s) => ({
      circuit: { ...s.circuit, components: [{ id: 'pb1', kind: 'pushbutton', x: 0, y: 0, rotation: 0, label: 'PB', properties: {} }], selectedIds: ['pb1'] },
      simulation: { ...s.simulation, components: {} },
    }));

    render(<Inspector />);

    const btn = screen.getByRole('button', { name: /Press and hold/i });
    btn.focus();

    // Keydown space (not a repeat) -> pressed
    fireEvent.keyDown(btn, { key: ' ', code: 'Space', repeat: false });
    expect(simulationClient.setControl).toHaveBeenCalledWith('pb1', true);

    // Keydown repeat -> should not call again
    fireEvent.keyDown(btn, { key: ' ', code: 'Space', repeat: true });
    // still only one call for press
    expect((simulationClient.setControl as unknown as jest.Mock).mock.calls.filter((c: any[]) => c[1] === true).length).toBe(1);

    // Keyup -> release
    fireEvent.keyUp(btn, { key: ' ', code: 'Space' });
    expect(simulationClient.setControl).toHaveBeenCalledWith('pb1', false);
  });

  it('potentiometer slider sends 0..1 values to simulationClient', () => {
    useAppStore.setState((s) => ({
      circuit: { ...s.circuit, components: [{ id: 'pot1', kind: 'potentiometer', x: 0, y: 0, rotation: 0, label: 'POT', properties: { initialPosition: 0.5 } }], selectedIds: ['pot1'] },
      simulation: { ...s.simulation, components: {} },
    }));

    render(<Inspector />);

    const slider = screen.getByRole('slider');
    // set to 100
    fireEvent.change(slider, { target: { value: '100' } });
    expect(simulationClient.setControl).toHaveBeenCalledWith('pot1', 1);

    // set to 0
    fireEvent.change(slider, { target: { value: '0' } });
    expect(simulationClient.setControl).toHaveBeenCalledWith('pot1', 0);
  });
});
