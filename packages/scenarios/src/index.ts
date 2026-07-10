export type { Scenario, ScenarioFixtureRef } from "./types";
export { scenarios, readyScenarios } from "./registry";
export { resolveAction, bookingCapabilities, recipeCapabilities, capabilitiesByScenario, slotFromLabel, type Capability, type CapabilityMatcher, type Resolution, type SurfaceComponentLike } from "./capabilities";
export { breakConditions, type BreakCondition } from "./break-conditions";
