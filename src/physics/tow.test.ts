import { describe, expect, it } from 'vitest';
import { towState } from './tow';

describe('towState', () => {
  it('gives the closest following car less drag and less downforce', () => {
    const state = towState(300, 1);
    expect(state.followingDragN).toBeLessThan(state.leadingDragN);
    expect(state.followingDownforceN).toBeLessThan(state.leadingDownforceN);
    expect(state.powerSavedW).toBeGreaterThan(0);
  });

  it('weakens the tow and downforce loss as the gap grows', () => {
    const close = towState(300, 2);
    const far = towState(300, 20);
    expect(far.wakeStrength).toBeLessThan(close.wakeStrength);
    expect(far.dragReduction).toBeLessThan(close.dragReduction);
    expect(far.downforceLoss).toBeLessThan(close.downforceLoss);
  });

  it('has no aerodynamic effect when parked', () => {
    const state = towState(0, 5);
    expect(state.leadingDragN).toBe(0);
    expect(state.followingDragN).toBe(0);
    expect(state.powerSavedW).toBe(0);
  });

  it('clamps negative speed and gap to their physical bounds', () => {
    const state = towState(-10, -4);
    expect(state.speedKmh).toBe(0);
    expect(state.gapM).toBe(0);
    expect(state.wakeStrength).toBe(1);
  });
});