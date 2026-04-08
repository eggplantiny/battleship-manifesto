/**
 * ManifestoBridge: generic interface between agents and MEL runtime.
 *
 * Does NOT hardcode action names. Any MEL action is callable via dispatch().
 * Absorbs dispatchAsync vs commitAsync difference.
 */
import { createSimulationSession } from "@manifesto-ai/sdk/extensions";

export class ManifestoBridge {
  constructor(
    private runtime: any,
    private useLineage: boolean = false,
  ) {}

  private getActionRef(action: string) {
    const melAction = this.runtime.MEL.actions[action];
    if (!melAction) throw new Error(`MEL action "${action}" not found`);
    return melAction;
  }

  /** Dispatch any MEL action by name. */
  dispatch(action: string, ...args: unknown[]) {
    const melAction = this.getActionRef(action);
    const intent = args.length > 0
      ? this.runtime.createIntent(melAction, ...args)
      : this.runtime.createIntent(melAction);
    return this.useLineage
      ? this.runtime.commitAsync(intent)
      : this.runtime.dispatchAsync(intent);
  }

  /** Query intent-level dispatchability without consuming budget. */
  isIntentDispatchable(action: string, ...args: unknown[]): boolean {
    if (typeof this.runtime.isIntentDispatchable !== "function") {
      throw new Error("Runtime does not expose isIntentDispatchable()");
    }
    return this.runtime.isIntentDispatchable(this.getActionRef(action), ...args);
  }

  /** Return dispatch blockers for the current snapshot. */
  getIntentBlockers(action: string, ...args: unknown[]) {
    if (typeof this.runtime.getIntentBlockers !== "function") {
      throw new Error("Runtime does not expose getIntentBlockers()");
    }
    return this.runtime.getIntentBlockers(this.getActionRef(action), ...args);
  }

  /** Read projected snapshot. */
  get snapshot() { return this.runtime.getSnapshot(); }
  get data() { return this.snapshot.data as Record<string, unknown>; }
  get computed() { return this.snapshot.computed as Record<string, unknown>; }

  /** Available actions from runtime. */
  get availableActions() { return this.runtime.getAvailableActions() as string[]; }

  /** Schema graph for causal tracing. */
  get schemaGraph() { return this.runtime.getSchemaGraph(); }

  /** MEL refs for sim.next() chains. */
  get mel() { return this.runtime.MEL; }

  /** Create a simulation session for lookahead evaluation. */
  createSimSession() { return createSimulationSession(this.runtime); }
}
