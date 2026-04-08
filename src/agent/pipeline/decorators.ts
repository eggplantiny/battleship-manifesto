import type { JsonValue } from "../../experiment/logging.js";
import type { ExperimentPipelineStage, PipelineRuntimeContext, StageResult } from "./experiment-pipeline.js";

type JsonRecord = Record<string, JsonValue>;

export function withStageLatency<I, O>(
  stage: ExperimentPipelineStage<I, O>,
): ExperimentPipelineStage<I, O> {
  return {
    name: stage.name,
    async run(input: I, ctx: PipelineRuntimeContext): Promise<StageResult<O>> {
      const startedAt = Date.now();
      const result = await stage.run(input, ctx);
      return {
        ...result,
        metadata: mergeMetadata(result.metadata, {
          latencyMs: Date.now() - startedAt,
        }),
      };
    },
  };
}

export function withStageLogging<I, O>(
  stage: ExperimentPipelineStage<I, O>,
): ExperimentPipelineStage<I, O> {
  return {
    name: stage.name,
    async run(input: I, ctx: PipelineRuntimeContext): Promise<StageResult<O>> {
      try {
        const result = await stage.run(input, ctx);
        ctx.logger?.log({
          turn: ctx.turn,
          source: ctx.source,
          type: "pipeline_stage",
          snapshot: ctx.getSnapshot(),
          data: {
            stage: stage.name,
            status: result.status ?? "success",
            proposalKind: result.proposalKind ?? null,
            metadata: result.metadata ?? null,
          },
        });
        return result;
      } catch (error) {
        ctx.logger?.log({
          turn: ctx.turn,
          source: ctx.source,
          type: "pipeline_stage",
          snapshot: ctx.getSnapshot(),
          data: {
            stage: stage.name,
            status: "error",
            proposalKind: null,
            metadata: {
              errorMessage: error instanceof Error ? error.message : String(error),
            },
          },
        });
        throw error;
      }
    },
  };
}

export function withFallbackLogging<I, O>(
  stage: ExperimentPipelineStage<I, O>,
): ExperimentPipelineStage<I, O> {
  return {
    name: stage.name,
    async run(input: I, ctx: PipelineRuntimeContext): Promise<StageResult<O>> {
      const result = await stage.run(input, ctx);
      const metadata = asJsonRecord(result.metadata);
      if (metadata?.usedFallback === true) {
        ctx.logger?.log({
          turn: ctx.turn,
          source: ctx.source,
          type: "pipeline_fallback",
          snapshot: ctx.getSnapshot(),
          data: {
            stage: stage.name,
            reason: typeof metadata.fallbackReason === "string" ? metadata.fallbackReason : null,
            metadata,
          },
        });
      }
      return result;
    },
  };
}

function mergeMetadata(left: JsonValue | undefined, right: JsonRecord): JsonValue {
  const base = asJsonRecord(left);
  if (!base) {
    return right;
  }
  return {
    ...base,
    ...right,
  };
}

function asJsonRecord(value: JsonValue | undefined): JsonRecord | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return value as JsonRecord;
}
