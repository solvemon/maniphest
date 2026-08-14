export { reduce, durationOf } from './reduce.ts';
export type { State, Player, Vessel } from './state.ts';
export { initialState, STATE_VERSION } from './state.ts';

export { defineAction } from './actions.ts';
export type { Action, WaitAction, ActionSpec } from './actions.ts';

export { ACTIONS } from './registry.ts';

export { reject, isRejection } from './rejection.ts';
export type { Rejection, RejectionReason } from './rejection.ts';
