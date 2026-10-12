/** REPORT.md: a derived view of runs.jsonl and summary.json, regenerated, never edited. */
import type { Corpus } from "./corpus";
import { PRICED_MODEL } from "./cost";
import type { EvaluationResult } from "./evaluate";
import type { ArmStats, Clarity, Decision, Interval, OperationCounts, OperationSensitivity, PairedCounts, SensitivityFailing, SensitivityReading } from "./metrics";
import { ARMS, CONDITIONS, type Path } from "./types";

const row = (cells: Array<string | number | null | undefined>) => `| ${cells.map((c) => (c === null || c === undefined ? "n/a" : String(c))).join(" | ")} |`;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(100 * v).toFixed(1)}%`);
const num = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "n/a" : v.toFixed(digits));
const ms = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${Math.round(v)} ms`);
/** A rate with the counts behind it (the ADR-B3 addendum: no rate without its numerator and denominator). */
const rate = (v: number | null | undefined, n: number, d: number) => (d === 0 ? "n/a" : `${pct(v)} (${n}/${d})`);
const signed = (v: number) => `${v >= 0 ? "+" : ""}${(100 * v).toFixed(1)}`;
/** A 95% paired cluster-bootstrap interval, as percent or as points of rate. */
const span = (iv: Interval | null, unit: "%" | " points") =>
  iv ? `95% interval ${unit === "%" ? `${(100 * iv.low).toFixed(1)}% to ${(100 * iv.high).toFixed(1)}%` : `${signed(iv.low)} to ${signed(iv.high)} points`}, ${iv.resamples} resamples over ${iv.prompts} prompts` : "no interval";
/** Tokens per success beside its numerator and denominator: metered tokens over metered successes. */
const perSuccess = (s: Pick<ArmStats, "tokensPerSuccess" | "meteredTokens" | "meteredSuccesses">) => (s.tokensPerSuccess === null ? "n/a" : `${num(s.tokensPerSuccess)} (${s.meteredTokens}/${s.meteredSuccesses})`);
/** A criterion's clarity; below the rule's minimum of prompts behind it, it is never called clear (the addendum). */
const clarityText = (c: Clarity, minimum: number): string =>
  c === "clear-pass"
    ? "clearly met"
    : c === "clear-fail"
      ? "clearly missed"
      : c === "uncertain"
        ? "uncertain: the interval straddles the threshold"
        : c === "insufficient"
          ? `insufficient: fewer prompts than the rule's minimum of ${minimum} stand behind it, so it is indicative at most and never called clear`
          : "not measurable";
const overallText = (o: Decision["clarity"]["overall"]) => (o === "insufficient" ? "too few prompts behind it to call" : o);
const ratioOf = (r: SensitivityReading, arm: "block" | "capped" | "production") => (r.evaluated[arm] === 0 ? null : r.passed[arm] / r.evaluated[arm]);
/** The missed count, with the misses that left the surface unchanged among them. */
const missText = (o: OperationCounts) => `${o.missed} missed${o.unchanged ? `, ${o.unchanged} of them unchanged` : ""}`;
/** The add and remove refinements behind a decision, by what they did (live/operation.ts): the decision's bullet. */
function sensitivityText(s: OperationSensitivity): string {
  const head = "- Add and remove refinements (live/operation.ts; beside the rule, never in it): ";
  const arms = [s.operation.block, s.operation.capped, s.operation.production];
  if (arms.every((o) => o.checked === 0)) return `${head}no passing add or remove refinement in the decision arms, so the verdict does not rest on one.`;
  const counts = (o: OperationCounts) => `(${o.mixed} mixed, ${missText(o)})`;
  const { block, capped, production } = s.operation;
  const done = `${head}block performed ${block.performed} of the ${block.checked} that passed ${counts(block)}; capped ${capped.performed} of ${capped.checked} ${counts(capped)}; production ${production.performed} of ${production.checked} ${counts(production)}.`;
  if (s.readings.length === 0) return `${done} Every one changed its lists the way its template asked, so the verdict does not rest on the check.`;
  return `${done} The decision recomputed with some of them counted as failures is below; the verdict above stands.`;
}
const FAILING_TEXT: Record<SensitivityFailing, string> = {
  missed: "the missed ones",
  "missed-and-mixed": "the missed and mixed ones",
  "changed-missed": "the missed ones that changed their surface",
  "changed-missed-and-mixed": "the missed ones that changed their surface, and the mixed ones",
};
const readingsCount = (n: number) => (n === 1 ? "one reading" : `${["two", "three", "four"][n - 2] ?? n} readings`);
/**
 * Each reading of the decision with some add and remove refinements counted as failures, and a conclusion drawn from all
 * of them, so it never calls the verdict safe while one of them moves it.
 */
function sensitivityReadings(s: OperationSensitivity, d: Decision): string[] {
  if (s.readings.length === 0) return [];
  const passRate = (r: SensitivityReading, arm: "block" | "capped" | "production") => rate(ratioOf(r, arm), r.passed[arm], r.evaluated[arm]);
  const named = (list: OperationSensitivity["readings"]) => `${readingsCount(list.length)}: ${list.map((r) => FAILING_TEXT[r.failing]).join("; ")}`;
  const moved = s.readings.filter((r) => r.reading.verdict !== d.verdict);
  const clarityOnly = s.readings.filter((r) => r.reading.verdict === d.verdict && r.reading.overall !== d.clarity.overall);
  const conclusion =
    moved.length > 0
      ? `The verdict changes in ${named(moved)}.${clarityOnly.length > 0 ? ` Its clarity alone changes in ${named(clarityOnly)}.` : ""}`
      : clarityOnly.length > 0
        ? `The verdict holds in every reading, but its clarity changes in ${named(clarityOnly)}.`
        : "Neither the verdict nor its clarity changes in any reading.";
  // An unchanged surface is the right answer where a template does not apply to it, which is why those readings exist.
  const unchanged = s.readings.some((r) => r.failing === "changed-missed" || r.failing === "changed-missed-and-mixed")
    ? " Leaving out the misses that left their surface unchanged matters where a template does not apply to a prompt's surface, since an unchanged surface is the right answer there; the add and remove table by block shows where they fall."
    : "";
  return [
    row(["Counted as failures", "Verdict", "Clarity", "Pass rate, block", "Pass rate, capped", "Pass rate, production", "Token reduction vs production"]),
    row(["---", "---", "---", "---:", "---:", "---:", "---:"]),
    ...s.readings.map(({ failing, reading }) => row([FAILING_TEXT[failing], reading.verdict, overallText(reading.overall), passRate(reading, "block"), passRate(reading, "capped"), passRate(reading, "production"), pct(reading.reductionVsProduction)])),
    "",
    `${conclusion}${unchanged}`,
    "",
  ];
}
/** Checklists with nothing to check are counted apart, never scored. */
const parityText = (p: ArmStats["parity"]) =>
  p.scored === 0 ? (p.noChecks ? `n/a (${p.noChecks} with no checks)` : "n/a") : `${pct(p.meanScore)} (${p.scored} scored${p.noChecks ? `, ${p.noChecks} with no checks` : ""})`;
const PATHS: readonly Path[] = ["block", "block-repair", "fallback", "primitive", "switch", "provider-failure", "invariant", "planning-failure"];
const pathsText = (s: ArmStats) => PATHS.filter((p) => s.paths[p]).map((p) => `${p} ${s.paths[p]!.passed}/${s.paths[p]!.n}`).join(", ") || "none";
const tally = (counts: Record<string, number>, label: (key: string) => string = (k) => k) => Object.entries(counts).map(([k, v]) => `${label(k)} ${v}`).join(", ") || "none";
const pairedText = (p: PairedCounts, first: string, second: string) =>
  `${p.prompts} prompts against ${second} (${first}'s thread pass rate higher on ${p.passRate.better}, the same on ${p.passRate.same}, lower on ${p.passRate.worse}; tokens per success lower on ${p.tokensPerSuccess.lower}, the same on ${p.tokensPerSuccess.same}, higher on ${p.tokensPerSuccess.higher}, of ${p.tokensPerSuccess.comparable} comparable)`;

export function renderReport(result: EvaluationResult, context: { providerId: string; corpus: Corpus }): string {
  const { summary, preflight } = result;
  const out: string[] = [
    `# Interface-blocks live evaluation (Phase 1B): run ${result.runId}`,
    "",
    "Generated by `pnpm --filter @dspack-studio/block-bench eval:live` from runs.jsonl. Do not edit by hand.",
    "",
    `Provider: \`${context.providerId}\`. Corpus: \`${context.corpus.corpus}\` v${context.corpus.version}, frozen ${context.corpus.frozenAt}. Cells: ${result.cells.done} of ${result.cells.total} done (${result.cells.reused} reused from the log).${result.stopped ? ` Stopped: ${result.stopped.reason}: ${result.stopped.message}` : ""}`,
    "",
    ...(result.servedModel
      ? [
          `Served model: \`${result.servedModel.id}\`, recorded ${result.servedModel.at} from the run's first metered call (manifest.json); every later call is held to it.${result.servedModel.id === PRICED_MODEL ? " It is the configured id, named by the provider itself rather than a dated snapshot, so it confirms no snapshot." : ""}`,
          "",
        ]
      : []),
    // A served model set aside stays on the record: the manifest named it, but none of the run's records showed it
    // measured.
    ...(result.setAside?.length
      ? [
          "Served models set aside (manifest.json): the manifest named each, but none of the run's records (requests.jsonl, runs.jsonl) showed it measured. From each, the run records the first model a reply that holds reports, as a fresh run does.",
          "",
          ...result.setAside.map((s) => `- ${s.at}: \`${s.servedModel.id}\`, recorded ${s.servedModel.at}, set aside by invocation ${s.invocation}`),
          "",
        ]
      : []),
    `Preflight (${preflight.at}): ${preflight.baseUrl ? `deployed at ${preflight.baseUrl}, build id ${preflight.buildId ?? "unknown"}, Worker ${preflight.worker?.shape ?? "not probed"}, hosted models ${preflight.models?.join(", ") ?? "unknown"}.` : "no deployment probed (not a hosted run)."}${preflight.model ? ` Local model ${preflight.model.name}, digest ${preflight.model.digest ?? "unknown"}.` : ""} Sidecars: ${preflight.sidecars.map((s) => `${s.reference} ${s.status}, binding ${s.binding}, usable ${s.usable.join(" ") || "none"}`).join("; ")}.`,
    "",
  ];
  // Every integrity stop stays on the record, however the run ended: a resume runs the cell each stopped again from its
  // start.
  const halts = result.invocations.filter((i) => i.stopped?.reason === "integrity");
  if (halts.length > 0) {
    out.push(
      `Integrity stops: ${halts.length}. Each stopped the run at a call it could not trust (live/integrity.ts); the cell in flight logged no record, and a resume runs the cell again from its start, drawing its result again.`,
      "",
      ...halts.map((i) => `- ${i.at}: ${i.stopped!.message}`),
      "",
    );
  }
  type Pacing = { maxRequests: number; spacingMs: number; backoffMs: number[]; sent: number; waits: Array<{ atMs: number; ms: number; reason: string }> };
  const paced = result.invocations.filter((i) => i.telemetry.pacing);
  if (paced.length > 0) {
    out.push("Pacing, for every invocation of this run:", "");
    paced.forEach((invocation, n) => {
      const pacing = invocation.telemetry.pacing as Pacing;
      const byReason = new Map<string, { n: number; ms: number }>();
      for (const w of pacing.waits) {
        const entry = byReason.get(w.reason) ?? { n: 0, ms: 0 };
        entry.n += 1;
        entry.ms += w.ms;
        byReason.set(w.reason, entry);
      }
      out.push(
        `- Invocation ${n + 1} (${invocation.at}): a cap of ${pacing.maxRequests} requests, ${pacing.spacingMs} ms between requests, backoff ${pacing.backoffMs.map((ms) => `${ms / 1000}s`).join(", ") || "none"}; ${pacing.sent} requests sent; waits: ${pacing.waits.length === 0 ? "none" : [...byReason].map(([reason, e]) => `${e.n} for ${reason} (${Math.round(e.ms / 1000)}s)`).join(", ")}.`,
      );
    });
    const run = result.requests;
    if (run) {
      out.push(
        run.capUsd !== undefined
          ? `- The run: a cumulative cap of ${run.cap} requests and a dollar ceiling of $${run.capUsd.toFixed(2)} across every invocation (manifest.json); ${run.sent} sent, $${run.usd.toFixed(2)} committed, what verified replies reported plus the worst case of every other request (requests.jsonl).`
          : `- The run: a cumulative cap of ${run.cap} requests across every invocation (manifest.json); ${run.sent} sent (requests.jsonl).`,
      );
    }
    out.push("");
  }
  if (preflight.drafts) out.push("**Provisional.** At least one sidecar in use is a draft. ADR-B3 counts approved sidecars only; these numbers inform the drafts, they do not graduate anything.", "");
  if (context.providerId === "fake:scripted") out.push("**Dry run.** The scripted provider calls no model: every figure that needs provider-reported usage reads n/a, and parity reflects the replayed worked examples, not generation.", "");
  out.push(
    "Tokens per success is the ADR-B3 figure: provider-reported input plus output across every call (planning included) of every evaluated run whose calls were all metered, failures included, divided by that cohort's successes. A run with a call missing either figure leaves the cohort. Pass rates exclude provider and policy failures, which are listed separately for re-running. Nothing here is estimated.",
    "",
  );

  out.push("## Decision (ADR-B3)", "");
  out.push(
    "The rule is a descriptive product decision rule: an engineering threshold, fixed before any run, for whether interface blocks earn Phase 2. It is not a statistical test, and meeting it is not publication-grade evidence. The independent unit is the prompt thread: one prompt on one reference in one arm, its fresh build and its refinements, which are repeated observations of that prompt and never independent samples. The minimum counts threads. Arms ran the same prompts, so they are compared paired by prompt, and every interval is a paired cluster bootstrap over prompts (docs/blocks/ADR-B3-ADDENDUM.md).",
    "",
  );
  if (summary.decisions.length === 0) out.push("No fresh cells with all three arms yet.", "");
  for (const d of summary.decisions) {
    const sensitivity = summary.sensitivity.filter((x) => x.reference === d.reference && x.provider === d.provider);
    out.push(`### ${d.reference} on ${d.provider}: **${d.verdict}** (${overallText(d.clarity.overall)})`, "");
    out.push(row(["Arm", "Prompt threads", "Evaluated cells", "Metered threads / cells", "Pass rate (passed/evaluated)", "Tokens per success (metered tokens/successes)"]), row(["---", "---:", "---:", "---:", "---:", "---:"]));
    for (const arm of ["block", "capped", "production"] as const) {
      out.push(row([arm, d.threads[arm], d.evaluated[arm], `${d.meteredThreads[arm]} / ${d.metered[arm]}`, rate(d.passRates[arm], d.counts.passed[arm], d.evaluated[arm]), d.tokens[arm] === null ? "n/a" : `${num(d.tokens[arm])} (${d.counts.meteredTokens[arm]}/${d.counts.meteredSuccesses[arm]})`]));
    }
    out.push(
      "",
      `- Token reduction vs production: ${pct(d.tokens.reductionVsProduction)} (${span(d.intervals.reductionVsProduction, "%")}): ${clarityText(d.clarity.tokens, d.options.minimum)}. Vs capped: ${pct(d.tokens.reductionVsCapped)} (${span(d.intervals.reductionVsCapped, "%")}).`,
      `- Pass rate, block minus production: ${d.passRates.block === null || d.passRates.production === null ? "n/a" : `${signed(d.passRates.block - d.passRates.production)} points`} (${span(d.intervals.passDiffVsProduction, " points")}): ${clarityText(d.clarity.vsProduction, d.options.minimum)}. Block minus capped: ${d.passRates.block === null || d.passRates.capped === null ? "n/a" : `${signed(d.passRates.block - d.passRates.capped)} points`} (${span(d.intervals.passDiffVsCapped, " points")}): ${clarityText(d.clarity.vsCapped, d.options.minimum)}.`,
      `- Compared paired by prompt: ${pairedText(d.paired.vsProduction, "block", "production")}; ${pairedText(d.paired.vsCapped, "block", "capped")}.`,
      `- The intervals resample the ${d.cohort} prompts every decision arm evaluated${d.cohort < d.options.minimum ? `, fewer than the ${d.options.minimum} the rule needs, so neither a criterion nor the decision can be called clear` : ""}.${d.meteredCohort < d.cohort ? ` The token figure rests on the ${d.meteredCohort} of them metered in both the block and production arms${d.meteredCohort < d.options.minimum ? `, fewer than the ${d.options.minimum} the rule needs` : ""}.` : ""}`,
      ...sensitivity.map(sensitivityText),
      "",
      ...sensitivity.flatMap((x) => sensitivityReadings(x, d)),
      `The decision pools every evaluated result of every condition, fresh builds and refinements alike, because ADR-B3 counts every call, refinements included. Rule: at least ${100 * d.options.reduction}% fewer tokens per success and a pass rate within ${100 * d.options.margin} points of both primitive arms, both boundaries inclusive, with at least ${d.options.minimum} evaluated and ${d.options.minimum} metered prompt threads per arm. The verdict reads the point estimates; a criterion is clear only when its whole interval sits on one side of its threshold, and the decision is clear only when its intervals agree with the verdict and rest on at least ${d.options.minimum} prompts every decision arm evaluated.`,
      "",
    );
    for (const reason of d.reasons) out.push(`- ${reason}`);
    out.push("");
  }

  const byRef = new Map<string, ArmStats[]>();
  for (const s of summary.arms) byRef.set(`${s.reference} on ${s.provider}`, [...(byRef.get(`${s.reference} on ${s.provider}`) ?? []), s]);
  for (const [title, stats] of byRef) {
    out.push(`## ${title}`, "");
    out.push("### Fresh builds", "");
    out.push(row(["Arm", "Cells", "Evaluated", "Passed", "Pass rate", "First attempt", "Repairs/success", "Tokens/success (metered tokens/successes)", "Metered runs", "Input/success", "Output/success", "Per passing run", "Provider calls/run", "Request bytes/run", "p50 total", "p50 first gated", "p50 block phase", "p50 emit", "p50 pacing", "Parity mean", "Re-run eligible"]));
    out.push(row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]));
    for (const s of stats.filter((x) => x.condition === "fresh")) {
      out.push(
        row([
          s.arm,
          s.n,
          s.evaluated,
          s.passed,
          rate(s.passRate, s.passed, s.evaluated),
          rate(s.firstAttemptPassRate, s.firstAttemptPassed, s.evaluated),
          num(s.repairsPerSuccess, 2),
          perSuccess(s),
          s.meteredRuns,
          num(s.inputTokensPerSuccess),
          num(s.outputTokensPerSuccess),
          num(s.tokensPerPassingRun),
          num(s.providerCallsPerRun, 2),
          num(s.requestBytesPerRun),
          ms(s.latency.totalMs),
          ms(s.latency.firstGatedAttemptMs),
          ms(s.latency.blockPhaseMs),
          ms(s.latency.emitMs),
          ms(s.latency.pacingMs),
          parityText(s.parity),
          s.rerunEligible,
        ]),
      );
    }
    out.push(
      "",
      "Latencies are execution time: the harness's own pacing and backoff waits are taken out and shown apart (p50 pacing, per cell). Input/success and Output/success split tokens per success: the cohort's input and output tokens over its successes.",
      "",
    );
    // Every arm and every condition, so a refinement's fallback or invariant failure is never out of sight: each is an
    // arm result in the totals the decision reads.
    const pooledHere = summary.pooled.filter((x) => `${x.reference} on ${x.provider}` === title);
    out.push("### Paths, fallbacks and invariant failures (every arm and condition)", "");
    out.push(row(["Condition", "Arm", "Completed", "Paths (passed/runs)", "Fallbacks by classification", "Budget left at fallback", "Invariant failures", "Budget exhausted"]));
    out.push(row(["---", "---", "---:", "---", "---", "---", "---:", "---:"]));
    const pathRow = (label: string, s: ArmStats) => row([label, s.arm, s.completed, pathsText(s), tally(s.fallbackByClassification), tally(s.budgetRemainingAtFallback, (k) => `${k} left:`), s.invariantFailures, s.budgetExhausted]);
    for (const condition of CONDITIONS) {
      for (const arm of ARMS) {
        const s = stats.find((x) => x.condition === condition && x.arm === arm);
        if (s) out.push(pathRow(condition, s));
      }
    }
    for (const arm of ARMS) {
      const s = pooledHere.find((x) => x.arm === arm);
      if (s) out.push(pathRow("all conditions", s));
    }
    out.push(
      "",
      "Fallbacks, switches and invariant failures are arm results in every condition (ADR-B3): each counts in its arm's pass rate and tokens per success. The all-conditions rows pool every condition, as the decision does for the block, capped and production arms. Completed also counts provider and policy failures, which the pass rate leaves out for re-running.",
      "",
    );
    const sel = summary.selection.find((x) => `${x.reference} on ${x.provider}` === title);
    if (sel) {
      out.push("### Selection accuracy (block arm, fresh)", "");
      out.push(row(["Prompts", "Accuracy", "Hit", "Missed to null", "Wrong block", "Null correct", "False block", "Explicit null", "Omitted", "Rejected", "Planning failed", "Intent accuracy"]));
      out.push(row(["---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]));
      out.push(row([sel.n, rate(sel.accuracy, sel.correct, sel.n), sel.hit, sel.missedToNull, sel.wrongBlock, sel.nullCorrect, sel.falseBlock, sel.explicitNull, sel.omitted, sel.rejected, sel.planningFailed, rate(sel.intentAccuracy, sel.intentCorrect, sel.n)]), "");
    }
    const refinements = stats.filter((x) => x.condition !== "fresh");
    if (refinements.length > 0) {
      out.push("### Refinements (on each arm's own fresh result)", "");
      out.push(row(["Condition", "Arm", "Cells", "Skipped", "Evaluated", "Pass rate", "Changed", "Operation performed", "Retention", "Tokens/success (metered tokens/successes)", "Re-run eligible"]));
      out.push(row(["---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]));
      const operation = (o: OperationCounts) => (o.checked === 0 ? "n/a" : `${rate(o.performed / o.checked, o.performed, o.checked)}; ${o.mixed} mixed, ${missText(o)}`);
      for (const s of refinements) out.push(row([s.condition, s.arm, s.n, s.skipped, s.evaluated, rate(s.passRate, s.passed, s.evaluated), rate(s.changedRate, s.changed, s.refinedPassed), operation(s.operation), rate(s.retention, s.retained, s.onBlockPrior), perSuccess(s), s.rerunEligible]));
      out.push(
        "",
        "Operation performed: of the passing add and remove refinements, those whose surface changed its lists the way the refinement asked (live/operation.ts); mixed ones changed lists both ways, missed ones changed none or only the other way, and an unchanged one left the surface exactly as it was. A node is matched by its id where that id occurs exactly once in both surfaces, otherwise by its place among its unmatched siblings of the same component, so a node matched by place that moves can read as lists changed both ways. The pass rate still counts every passing refinement, as ADR-B3 froze the pass; under each decision, its add and remove readings show whether the verdict or its clarity changes when these count as failures.",
        "",
      );
      // By block, per arm: a template that fits some prompts' surfaces and not others shows where its misses fall.
      const adds = refinements.filter((x) => (x.condition === "refine-add" || x.condition === "refine-remove") && x.operation.checked > 0);
      if (adds.length > 0) {
        const arms = ARMS.filter((arm) => adds.some((x) => x.arm === arm));
        const blocks = [...new Set(adds.flatMap((x) => Object.keys(x.operationByBlock)))].sort((a, b) => (a === "null" ? 1 : b === "null" ? -1 : a.localeCompare(b)));
        const cell = (o: OperationCounts | undefined) => (!o || o.checked === 0 ? "n/a" : `${o.performed}/${o.checked}${o.mixed || o.missed ? `; ${o.mixed} mixed, ${missText(o)}` : ""}`);
        out.push("### Add and remove refinements, by block", "");
        out.push(row(["Condition", "Block", ...arms]), row(["---", "---", ...arms.map(() => "---:")]));
        for (const condition of ["refine-add", "refine-remove"] as const) {
          for (const block of blocks) {
            const cells = arms.map((arm) => cell(adds.find((x) => x.condition === condition && x.arm === arm)?.operationByBlock[block]));
            if (cells.some((c) => c !== "n/a")) out.push(row([condition, block, ...cells]));
          }
        }
        out.push(
          "",
          "Performed of checked, per arm. A template that does not apply to a prompt's surface (an add of an item already there, a remove of one that is absent) shows here as misses, often unchanged, in the arms whose surfaces it does not fit.",
          "",
        );
      }
    }
    if (stats.some((x) => x.arm === "block-positional")) {
      const pooled = summary.pooled.filter((x) => `${x.reference} on ${x.provider}` === title);
      out.push("### Named vs positional encoding (ADR-B2)", "");
      out.push(row(["Condition", "Encoding", "Cells", "Evaluated", "Pass rate", "Tokens/success (metered tokens/successes)", "Input/success", "Output/success", "Provider calls/run", "Request bytes/run", "p50 block phase"]));
      out.push(row(["---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]));
      for (const condition of ["all", ...CONDITIONS]) {
        for (const [encoding, arm] of [["named", "block"], ["positional", "block-positional"]] as const) {
          const s = (condition === "all" ? pooled : stats).find((x) => x.arm === arm && x.condition === condition);
          if (s) out.push(row([condition, encoding, s.n, s.evaluated, rate(s.passRate, s.passed, s.evaluated), perSuccess(s), num(s.inputTokensPerSuccess), num(s.outputTokensPerSuccess), num(s.providerCallsPerRun, 2), num(s.requestBytesPerRun), ms(s.latency.blockPhaseMs)]));
        }
      }
      const enc = summary.encodings.find((e) => `${e.reference} on ${e.provider}` === title);
      if (enc) {
        out.push(
          "",
          `Positional against named, compared paired by prompt: ${pairedText(enc.paired, "positional", "named")}. Pass rate, positional minus named: ${span(enc.intervals.passDiff, " points")}; positional's token reduction against named: ${span(enc.intervals.tokenReduction, "%")}.`,
        );
      }
      out.push("", "The same named call on the wire two ways: the positional answer is decoded to the named call before B1, so the gates, the expansion and the parity check are the named arm's. The ADR-B3 decision reads the named block arm; this comparison informs ADR-B2 and decides nothing.", "");
    }
    const failures = stats.filter((x) => x.rerunEligible > 0);
    if (failures.length > 0) {
      out.push("### Provider and policy failures (re-run symmetrically; not arm results)", "");
      out.push(row(["Condition", "Arm", "Provider", "Policy", "At planning"]), row(["---", "---", "---:", "---:", "---:"]));
      for (const s of failures) out.push(row([s.condition, s.arm, s.rerunByKind.provider ?? 0, s.rerunByKind.policy ?? 0, s.paths["planning-failure"]?.n ?? 0]));
      out.push("");
    }
  }
  // Three states: not selected, selected but not reached (the run stopped first), reached (the table above).
  const positional = !result.arms.includes("block-positional")
    ? "the block-positional arm was not in this run's selection."
    : summary.arms.some((x) => x.arm === "block-positional")
      ? null
      : result.stopped
        ? "the block-positional arm is selected, but the run stopped before any of its cells ran; resume the run to reach it."
        : "the block-positional arm is selected, but no cell of it was planned.";
  out.push(
    "## Not measured in this run",
    "",
    ...(positional ? [`- Named vs positional encoding: ${positional}`] : []),
    "- Time to first valid preview equals completion today (ADR-B3) and is the p50 total above, which, like every latency here, leaves out the harness's pacing waits.",
    `- Action names in parity: the plan behind ADR-B3 lists them in the parity checklist, but the frozen corpus (${context.corpus.corpus} v${context.corpus.version}) names none, so parity scores labels and components only and cannot show whether an expected action exists. A checklist with nothing to check is not scored.`,
    "",
  );
  out.push(`Totals: ${summary.totals.records} records, ${summary.totals.completed} completed, ${summary.totals.providerCalls} provider calls, ${summary.totals.inputTokens} input and ${summary.totals.outputTokens} output tokens reported, ${summary.totals.requestBytes} request bytes.`, "");
  const s = result.superseded;
  if (s.records > 0) {
    out.push(`Superseded by re-runs: ${s.records} records, ${s.providerCalls} provider calls, ${s.inputTokens} input and ${s.outputTokens} output tokens, ${s.requestBytes} request bytes. Spent, and counted in no arm; the records are in runs.superseded.jsonl.`, "");
  }
  return `${out.join("\n")}`;
}
