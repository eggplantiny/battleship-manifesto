export interface LLMDecisionTelemetry {
  rawResponse: string;
  errorMessage: string;
  latencyMs: number;
}

export class BattleshipEffectTelemetryStore {
  private llmDecision: LLMDecisionTelemetry | null = null;

  recordLLMDecision(telemetry: LLMDecisionTelemetry): void {
    this.llmDecision = telemetry;
  }

  consumeLLMDecision(): LLMDecisionTelemetry | null {
    const current = this.llmDecision;
    this.llmDecision = null;
    return current;
  }

  clearLLMDecision(): void {
    this.llmDecision = null;
  }
}
