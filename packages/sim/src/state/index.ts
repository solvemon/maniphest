export { reduce, durationOf } from './reduce.ts';
export type { State, Player, Vessel } from './state.ts';
export { initialState, STATE_VERSION } from './state.ts';

export { defineAction } from './actions.ts';
export type { Action, WaitAction, ActionSpec } from './actions.ts';
export type { JumpAction, DockAction, UndockAction } from './actions.ts';
export type { RefuelAction } from './actions.ts';
export type { RescueAction } from './actions.ts';

export { ACTIONS } from './registry.ts';

export { DOCKING_TICKS, JUMP_TICKS_PER_DISTANCE } from './movement.ts';

export { isStranded, fuelCostOf, FUEL_PER_DISTANCE, FUEL_PRICE_PER_UNIT, REFUEL_TICKS } from './fuel.ts';

export { rescueSpec, nearestDepot, RESCUE_CREDIT_SHARE } from './rescue.ts';

export { reject, isRejection } from './rejection.ts';
export type { Rejection, RejectionReason } from './rejection.ts';
