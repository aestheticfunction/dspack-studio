export {
  PROJECT_VERSION,
  projectManifestSchema,
  parseProjectManifest,
  type ProjectManifest,
  type ManifestIssue,
  type ParseManifestResult,
} from "./project";
export {
  sectionHash,
  ledgerStatus,
  componentEntryStatuses,
  preservesLedger,
  restoreComponent,
  addTombstone,
  removeTombstone,
  applyFreshFact,
  LEDGER_V2,
  type LedgerStatus,
  type SectionStatus,
  type SectionState,
  type ComponentEntryStatus,
  type ComponentEntryState,
  type LedgerActionResult,
  type FreshFact,
} from "./ledger";
export { finding, countBySeverity, type ComposerFinding, type FindingGate, type FindingSeverity } from "./findings";
export {
  COMPOSER_ADAPTERS,
  composerAdapter,
  type ComposerAdapter,
  type DiscoveryRef,
  type MappingRef,
  type RenderingRef,
  type DriftRef,
} from "./adapters";
