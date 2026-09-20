import type { SchedulerState } from './scheduler';
import type { ChangeEvent, CaptureProgress, Counts, Postponed, Relations, SnapshotKind } from './types';

export type Msg =
  | { kind: 'capture' }
  | { kind: 'history' }
  | { kind: 'watch'; on: boolean; minutes?: number }
  | { kind: 'wipe' };

/** Avisos del service worker. El popup se pinta a partir de esto. */
export type Broadcast =
  | { kind: 'tick-start'; force: boolean }
  | { kind: 'progress'; progress: CaptureProgress }
  /** Ademas del resultado, avisa de que ya se pueden descargar avatares. */
  | { kind: 'tick-done'; result: TickResponse };

export interface TickResponse {
  ran?: boolean;
  /** Por que no se hizo nada, si ran es false. */
  skipped?: string;
  requests?: number;
  enumerated?: SnapshotKind[];
  /** El suelo dejo alguna lista para luego: el popup lo explica. */
  postponed?: Postponed[];
  state?: SchedulerState;
  error?: string;
}

/** El popup lo traduce; el usuario no tiene por que leer "require_login". */
export type ProblemCode = 'no-session' | 'hard-block' | 'soft-block' | null;

export interface KindSummary {
  snapshots: number;
  bases: number;
  lastAt: number | null;
  lastCount: number | null;
}

export interface HistoryResponse {
  /** Vacio hasta la primera captura completa. */
  ready?: boolean;
  username?: string | null;
  counts?: Counts | null;
  changes?: ChangeEvent[];
  relations?: Relations;
  summary?: { followers: KindSummary; following: KindSummary };
  state?: SchedulerState;
  nextPollAt?: number | null;
  busy?: boolean;
  problem?: ProblemCode;
  error?: string;
}
