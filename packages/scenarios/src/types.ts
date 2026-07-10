/**
 * The scenario framework: a scenario is DATA, not a page. Every scenario
 * plugs the same substrate — recorded fixtures for replay, seed prompts for
 * live runs, an intent for the governed pipeline — and inherits the whole
 * experience (timeline, scrubbing, gate ticker, failure panel, inspection,
 * A2UI generation, Astryx rendering) without any per-scenario UI code.
 */

export interface ScenarioFixtureRef {
  key: string;
  label: string;
  /** One-line story of what this recording shows. */
  blurb: string;
  /** Parsed fixture JSON (a ReplayFixture document). */
  fixture: unknown;
}

export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  /** Contract intent the pipeline runs under. Must exist in the contract. */
  intent: string;
  /** Prompts offered in the live view (the first is the default). */
  seedPrompts: string[];
  /** Prompts engineered to trip specific rules (FM-8 material). */
  breakItPrompts?: Array<{ ruleId: string; prompt: string }>;
  /** Curated recordings for the replay view. */
  fixtures: ScenarioFixtureRef[];
  /**
   * Planned scenarios ship as entries with status "planned" (no fixtures
   * yet) so the shelf communicates the roadmap honestly — they are not
   * selectable until they carry real recordings and, where needed, their
   * contract expansion (new intents/rules are owner-authored).
   */
  status: "ready" | "planned";
  /** For planned scenarios: what has to exist first. */
  needs?: string[];
  /**
   * Interactive scenarios start from a deterministic contract-emitted surface
   * (no model call) and answer rendered actions through the agent's HITL
   * responder. Their live-generation path stays gated on owner-authored
   * contract governance for the scenario's intent.
   */
  interactive?: boolean;
}
