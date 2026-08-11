/**
 * The flow shape (P4) — lifted here so BOTH homes gate the same rules:
 *
 *   - browser projects: apps/composer/app/flows.ts re-exports these types;
 *     its hand-rolled parseFlow (behavior pinned by its own suite) is the
 *     store/import gate and must stay rule-identical to this schema;
 *   - repository projects: the STRICT project manifest carries an optional
 *     `flows` array validated with this schema, and the agent's save-flow
 *     route applies parseFlows before writing project.json.
 *
 * The rules, in one place: required id/name/steps (steps require
 * id/title/surfaceId); optional description string, advanceOn string[],
 * terminal boolean; `on` is the RESERVED linear-v1 branching annotation
 * (F4) — [{event, to}] validated when present, never executed. Unknown keys
 * are DROPPED, not refused (zod's default strip mode — matching the browser
 * parser), and wrong TYPES refuse. Deliberately no min-length constraints:
 * the two gates must agree exactly, and the browser parser accepts any
 * string — ids are minted non-empty by the UI, not by the shape.
 */
import { z } from "zod";

export const flowStepSchema = z.object({
  /** step.<slug> — unique within its flow. */
  id: z.string(),
  title: z.string(),
  /** The example id of an existing surface in the project's merged corpus. */
  surfaceId: z.string(),
  /** Emitted action names that MEAN "this step completes" (Preview advances). */
  advanceOn: z.array(z.string()).optional(),
  /** RESERVED branching annotation (F4): validated when present, unimplemented. */
  on: z.array(z.object({ event: z.string(), to: z.string() })).optional(),
  /** Marks completion; defaults to the last step. */
  terminal: z.boolean().optional(),
});

export const flowSchema = z.object({
  /** flow.<slug> — unique within the project. */
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(flowStepSchema),
});

export type FlowStep = z.infer<typeof flowStepSchema>;
export type Flow = z.infer<typeof flowSchema>;

export interface FlowsIssue {
  path: string;
  message: string;
}

export type ParseFlowsResult = { ok: true; flows: Flow[] } | { ok: false; issues: FlowsIssue[] };

/** The array gate the agent's save-flow route applies (mirror of
 *  parseProjectManifest's result idiom): all-or-nothing, pathed issues. */
export function parseFlows(value: unknown): ParseFlowsResult {
  const result = z.array(flowSchema).safeParse(value);
  if (result.success) return { ok: true, flows: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}
