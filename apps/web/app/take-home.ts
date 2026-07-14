/**
 * FM-11 take-it-home: the pure logic behind the take-home view.
 *
 * The validator here is the real one: dspack-gen's `/core` subpath
 * (zero-network, emitter-free by that package's own boundary test) bundled
 * into the static export, linting against the SAME byte-synced contract the
 * studio's pipeline runs under. Nothing pasted into the box leaves the
 * browser. Findings pass through unmodified — this module adds no
 * interpretation of its own.
 *
 * Import isolation note: `@aestheticfunction/dspack-gen` is a published npm
 * package consumed normally; the isolation rules confine `@a2ui/*`,
 * `@ag-ui/*`, and design-system imports, none of which appear here.
 */
import {
  lintSurface,
  renderText,
  UnknownRuleTypeError,
  type Contract,
  type LintReport,
} from "@aestheticfunction/dspack-gen/core";
import contractJson from "@dspack-studio/contracts/astryx.dspack.json";
import fixture001 from "@dspack-studio/replay/fixtures/fixture-001.json";

/**
 * The minimum ds-mcp the config may reference: 0.3.1 re-pinned the vendored
 * dspack-gen core to v0.1.1, so its served generation schema matches what
 * this studio generates under. Earlier versions serve a pre-0.1.1 schema.
 */
export const DS_MCP_RANGE = "^0.3.1";

/** Build-time byte copy of packages/contracts/astryx.dspack.json (see scripts/take-home-assets.mjs). */
export const CONTRACT_DOWNLOAD_PATH = "/take-home/astryx.dspack.json";

/** The placeholder the visitor replaces; MCP hosts run servers from an arbitrary cwd, so the path must be absolute. */
export const CONTRACT_PATH_PLACEHOLDER = "/absolute/path/to/astryx.dspack.json";

/** The MCP client config, the standard mcpServers shape. */
export function mcpConfig(): string {
  return JSON.stringify(
    {
      mcpServers: {
        "design-system": {
          command: "npx",
          args: ["-y", `@aestheticfunction/ds-mcp@${DS_MCP_RANGE}`, "--dspack", CONTRACT_PATH_PLACEHOLDER],
        },
      },
    },
    null,
    2,
  );
}

/** The clone-and-run local agent path (launch-day option; no published agent package to reference yet). */
export const LOCAL_AGENT_COMMANDS = [
  "git clone https://github.com/aestheticfunction/dspack-studio.git",
  "cd dspack-studio && pnpm install && pnpm build:contracts",
  "pnpm --filter agent dev",
] as const;

export type ValidateOutcome =
  | { kind: "report"; report: LintReport; text: string }
  | { kind: "rejected"; reason: string };

/**
 * Validate a pasted dspack surface against the studio's contract. Parse
 * errors and linter refusals are reported verbatim; findings are the
 * linter's own, untouched.
 */
export function validatePasted(raw: string): ValidateOutcome {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "rejected", reason: "nothing pasted yet" };
  let surface: unknown;
  try {
    surface = JSON.parse(trimmed);
  } catch (err) {
    return { kind: "rejected", reason: `not JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const report = lintSurface(surface, contractJson as unknown as Contract);
    return { kind: "report", report, text: renderText(report) };
  } catch (err) {
    if (err instanceof UnknownRuleTypeError) {
      return { kind: "rejected", reason: `the linter refused: ${err.message}` };
    }
    throw err;
  }
}

interface GatesEventValue {
  index: number;
  surface: unknown;
  gates: Array<{ gate: string; status: string }>;
  findings: unknown[];
}

/**
 * The caught example: fixture-001's attempt-0 surface, exactly as the
 * recorded live run proposed it before the S3 gate failed it. Pasting this
 * into the validate box must reproduce the recorded findings — that
 * agreement is asserted by test, not assumed.
 */
export function caughtExample(): { surfaceJson: string; recordedFindings: unknown[] } {
  const events = (fixture001 as { events: Array<{ event: Record<string, unknown> }> }).events;
  for (const { event } of events) {
    if (event.type !== "CUSTOM" || event.name !== "dspack.gates") continue;
    const value = event.value as unknown as GatesEventValue;
    if (value.gates.some((g) => g.status === "FAIL")) {
      return { surfaceJson: JSON.stringify(value.surface, null, 2), recordedFindings: value.findings };
    }
  }
  throw new Error("fixture-001 carries no failed gate attempt — the caught example is gone");
}
