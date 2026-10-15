/** Offline: the shadcn/ui v3 Stage-3 window-1 command, through the harness's own option parser, selection check, frozen
    pin and cell planner at this checkout, with the corpus digest and the code identity. No network, no provider.
    Usage: npx tsx plan-check.mts <date> (run from packages/block-bench). */
import { parseOptions, validateSelection } from "/home/user/dspack-studio/packages/block-bench/live/run.ts";
import { corpusDigest, frozenMismatches, frozenPinPath, readCorpusVersion, readFrozenPin, scoringOf } from "/home/user/dspack-studio/packages/block-bench/live/corpus.ts";
import { planCells } from "/home/user/dspack-studio/packages/block-bench/live/evaluate.ts";
import { loadReference } from "/home/user/dspack-studio/packages/block-bench/live/references.ts";
import { codeIdentity } from "/home/user/dspack-studio/packages/block-bench/live/identity.ts";

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("usage: plan-check.mts <yyyy-mm-dd>");
const prompts = "rt-01,rt-02,rt-03,rt-04,rt-05,rt-06,af-01,af-02,af-03,af-04,af-05,af-06,gs-01,gs-02,gs-03,gs-04,gs-05,gs-06,nb-01,nb-02,nb-03,nb-04,nb-05,nb-06";
const argv = ["--provider", "hosted", "--corpus", "2", "--reference", "shadcn-v3", "--prompts", prompts, "--max-total-usd", "77", "--max-total-requests", "1275", "--max-requests", "123", "--spacing-ms", "12000", "--out", `live/runs/1b-stage3-shadcn-${date}`];
const o = parseOptions(argv);
const corpus = readCorpusVersion(o.corpusVersion);
validateSelection(o, corpus);
const unfrozen = await frozenMismatches(corpus, readFrozenPin(frozenPinPath(o.corpusVersion)));
const references = await Promise.all(o.references.map((id) => loadReference(id)));
const cells = planCells({ references, corpus, ...(o.prompts ? { promptIds: o.prompts } : {}) });
console.log(JSON.stringify({
  cells: cells.length,
  references: o.references,
  corpus: `${corpus.corpus} v${corpus.version}`,
  digest: await corpusDigest(corpus),
  frozen: unfrozen.length === 0,
  scoring: scoringOf(corpus),
  sidecars: references.map((r) => `${r.id}:${r.sidecar?.status}:${r.binding}:${r.blocks.map((b) => b.id).join("+")}`),
  maxTotalUsd: o.maxTotalUsd,
  maxTotalRequests: o.maxTotalRequests,
  maxRequests: o.maxRequests,
  spacingMs: o.spacingMs,
  out: o.out,
  resume: o.resume ?? null,
  rerunFailed: o.rerunFailed,
  allowDrafts: o.allowDrafts ?? false,
}));
console.log(`code identity ${codeIdentity().sha256}`);
