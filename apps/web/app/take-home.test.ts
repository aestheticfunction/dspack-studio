/**
 * FM-11 unit gates.
 *
 * The findings-agreement test is the honesty check in the receipts spirit:
 * the in-browser validator and the recorded pipeline must say the same
 * thing about the same surface — byte-compared findings, not vibes. The
 * version assertions are literal so a future copy edit cannot silently
 * reference a ds-mcp older than 0.3.1 (which serves the pre-0.1.1 schema).
 */
import { describe, expect, it } from "vitest";
import {
  CONTRACT_PATH_PLACEHOLDER,
  DS_MCP_RANGE,
  LOCAL_AGENT_COMMANDS,
  caughtExample,
  mcpConfig,
  validatePasted,
} from "./take-home";
import contractJson from "@dspack-studio/contracts/astryx.dspack.json";

describe("mcp config", () => {
  it("pins ds-mcp to ^0.3.1 or a higher floor, never 0.3.0 or older", () => {
    expect(DS_MCP_RANGE.startsWith("^")).toBe(true);
    const [major, minor, patch] = DS_MCP_RANGE.slice(1).split(".").map(Number);
    expect(major * 1_000_000 + minor * 1_000 + patch).toBeGreaterThanOrEqual(3_001);
    const config = JSON.parse(mcpConfig()) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const server = config.mcpServers["design-system"];
    expect(server.command).toBe("npx");
    expect(server.args).toContain(`@aestheticfunction/ds-mcp@${DS_MCP_RANGE}`);
    expect(server.args).toContain("--dspack");
    expect(server.args).toContain(CONTRACT_PATH_PLACEHOLDER);
  });

  it("references no unpublished package anywhere in the visitor-facing commands", () => {
    for (const cmd of LOCAL_AGENT_COMMANDS) {
      expect(cmd).not.toMatch(/dspack-studio-agent/);
    }
  });
});

describe("validatePasted", () => {
  it("reports parse errors verbatim, evaluating nothing", () => {
    const out = validatePasted("{this is not json");
    expect(out.kind).toBe("rejected");
    if (out.kind === "rejected") expect(out.reason).toMatch(/^not JSON: /);
  });

  it("says so when nothing is pasted", () => {
    expect(validatePasted("   ")).toEqual({ kind: "rejected", reason: "nothing pasted yet" });
  });

  it("passes the contract's own worked example clean (S1/S2/S3)", () => {
    const example = (contractJson as { examples: Array<{ surface: unknown }> }).examples[0];
    const out = validatePasted(JSON.stringify(example.surface));
    expect(out.kind).toBe("report");
    if (out.kind === "report") {
      expect(out.report.pass).toBe(true);
      expect(out.report.gates.map((g) => g.status)).toEqual(["PASS", "PASS", "PASS"]);
    }
  });
});

describe("honesty: the browser validator agrees with the recorded pipeline", () => {
  it("fixture-001's caught attempt-0 surface reproduces the recorded findings, byte for byte", () => {
    const { surfaceJson, recordedFindings } = caughtExample();
    const out = validatePasted(surfaceJson);
    expect(out.kind).toBe("report");
    if (out.kind !== "report") return;
    expect(out.report.pass).toBe(false);
    // The recorded run's dspack.gates event carries the findings the live
    // pipeline computed in 2026 on gemma4:e4b's real output; the validator
    // bundled into this page must produce the identical list.
    expect(JSON.stringify(out.report.findings, null, 2)).toBe(JSON.stringify(recordedFindings, null, 2));
  });
});
