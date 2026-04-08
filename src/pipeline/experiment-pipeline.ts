import type { GameLogger, JsonValue, SnapshotSummary } from "../experiment/logging.js";

export interface StageResult<T> {
  value: T;
  status?: string;
  proposalKind?: string;
  metadata?: JsonValue;
}

export interface PipelineRuntimeContext {
  turn: number;
  source: string;
  logger?: GameLogger;
  getSnapshot: () => SnapshotSummary;
}

export interface ExperimentPipelineStage<I, O> {
  readonly name: string;
  run(input: I, ctx: PipelineRuntimeContext): Promise<StageResult<O>>;
}
