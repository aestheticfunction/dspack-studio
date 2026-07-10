/**
 * Astryx vocabulary drift check: compares the contract's mechanical layer
 * (component ids, prop names, enum values) against Astryx's own machine-
 * readable docs (`astryx component <Name> --json`).
 *
 * Report-only by default (exit 0) — the governance layer is hand-authored and
 * drift is expected as Astryx Beta moves; findings feed contract revisions
 * upstream. Pass --strict to fail CI on any finding.
 *
 * Known-drift note (v0.1.2 -> v0.1.4, found at authoring time):
 *   - card.variant: contract says outlined/elevated/filled; Astryx Card has
 *     default/muted/<colors>.
 *   - text.as: contract includes h1/h2/h3; Astryx Text renders headings via
 *     `type`, and `as` only accepts span/p/div/label.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(readFileSync(join(root, "astryx.dspack.json"), "utf8"));
const strict = process.argv.includes("--strict");

/** dspack component id -> Astryx component name (the CLI's vocabulary). */
const ASTRYX_NAME: Record<string, string> = {
  "alert-dialog": "AlertDialog",
  dialog: "Dialog",
  button: "Button",
  badge: "Badge",
  card: "Card",
  "text-input": "TextInput",
  "dropdown-menu": "DropdownMenu",
  table: "Table",
  text: "Text",
};

interface AstryxProp {
  name: string;
  type?: string;
  default?: string;
}

function astryxProps(name: string): AstryxProp[] | null {
  try {
    const out = execFileSync("npx", ["astryx", "component", name, "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(out);
    return parsed?.data?.props ?? [];
  } catch {
    return null;
  }
}

const findings: string[] = [];
const unverified: string[] = [];

for (const [id, comp] of Object.entries<any>(doc.components ?? {})) {
  const astryxName = ASTRYX_NAME[id];
  if (!astryxName) {
    findings.push(`${id}: no Astryx name mapping in drift-check`);
    continue;
  }
  const props = astryxProps(astryxName);
  if (props === null) {
    findings.push(`${id}: Astryx CLI has no component '${astryxName}'`);
    continue;
  }
  const byName = new Map(props.map((p) => [p.name, p]));
  for (const [propName, propDef] of Object.entries<any>(comp.props ?? {})) {
    const ap = byName.get(propName);
    if (!ap) {
      findings.push(`${id}.${propName}: prop not found on Astryx ${astryxName}`);
      continue;
    }
    const values: string[] = propDef?.values ?? [];
    if (values.length === 0) continue;
    // Union types render as 'a' | 'b' in the CLI's type string; a bare type
    // alias (e.g. ButtonVariant) is unexpanded and cannot be checked here.
    if (!ap.type?.includes("'")) {
      unverified.push(`${id}.${propName}: Astryx type '${ap.type}' is an unexpanded alias`);
      continue;
    }
    for (const v of values) {
      if (!ap.type.includes(`'${v}'`)) {
        findings.push(
          `${id}.${propName}: contract value '${v}' not in Astryx type ${ap.type}`,
        );
      }
    }
  }
}

if (findings.length === 0) {
  console.log("drift-check: contract vocabulary matches Astryx docs");
} else {
  console.log(`drift-check: ${findings.length} finding(s)`);
  for (const f of findings) console.log(`  - ${f}`);
}
if (unverified.length > 0) {
  console.log(`drift-check: ${unverified.length} unverifiable (type aliases)`);
  for (const u of unverified) console.log(`  ~ ${u}`);
}
process.exit(strict && findings.length > 0 ? 1 : 0);
