/**
 * A provider is the one nondeterministic step, behind the same structural
 * adapter the block phase and the pipeline share. The harness injects, per
 * ADR-B4, the classifier and the error factory the block phase needs; both
 * arms of a run share them, so they share the unusable-output rule.
 */
import { AdapterOutputError } from "@aestheticfunction/dspack-gen/adapter-types";
import type { CallRecorder, Usage } from "@dspack-studio/composer-core";
import type { BlockDefinition, CallEncoding, ErrorKind, GenerateRequest, StructuralAdapter } from "@dspack-studio/composer-core/blocks";
import { PacingCapReached, type Pacer } from "../pacing";
import type { FailureKind } from "../types";

/** Counts what left the harness: request bodies in bytes, and how many. */
export interface Meter {
  bytes: number;
  requests: number;
}
export const createMeter = (): Meter => ({ bytes: 0, requests: 0 });

export interface AdapterOptions {
  recorder: CallRecorder;
  meter: Meter;
  refinement: boolean;
  /** Hosted only: cap the Worker's provider calls for each request (1 in block mode). Absent means today's bytes. */
  maxCalls?: 1 | 2;
  /** Scripted only: the intent's worked example to replay, and the prior surface a refinement edits. */
  scripted?: { example: unknown; prior?: unknown; goal: string };
}

export interface BlockAdapterOptions extends AdapterOptions {
  block: BlockDefinition;
  intent: string;
  goal: string;
  /** The encoding the block phase asks for; the request carries it, and the scripted provider answers in it. */
  encoding: CallEncoding;
  seed?: { priorGoal: string; priorCall: Record<string, unknown> };
}

export interface PlanOptions {
  recorder: CallRecorder;
  meter: Meter;
}

export interface Provider {
  /** The adapter id recorded in audit reports (e.g. hosted-ai:claude-haiku-4.5, ollama:gpt-oss:latest, fake:scripted). */
  id: string;
  /** What a resume must match: the id plus the endpoint, model or mode behind it. */
  descriptor: string;
  kind: "hosted" | "ollama" | "scripted";
  /** Called before a cell's first request; a hosted provider refuses the cell when its cap cannot cover it (PacingCapReached). */
  beforeCell?(): void;
  /** Hosted: the pacer every request passes through, so the runner can bind the run's cumulative ledger to it. */
  readonly pacer?: Pacer;
  /** What the run report records about this provider (pacing, waits). */
  telemetry?(): Record<string, unknown> | undefined;
  /** Whether this provider answers the planning request with a model (scripted routes deterministically). */
  plansWithModel: boolean;
  /** The surface adapter (generation, refinement, repairs). */
  surfaceAdapter(options: AdapterOptions): StructuralAdapter;
  /** The block-call adapter (the block phase's calls). */
  blockAdapter(options: BlockAdapterOptions): StructuralAdapter;
  /** One planning request. Throws a HarnessError on failure. */
  plan(request: GenerateRequest, options: PlanOptions): Promise<unknown>;
  classify(error: unknown): ErrorKind;
  makeError(kind: string, message: string, cause?: unknown): Error;
}

/**
 * The harness's typed adapter error, shaped like the app's GatewayError: an
 * AdapterOutputError (so runPipeline records failed-adapter) that carries
 * the failure kind, the HTTP status, the Worker's cause and the usage.
 */
export class HarnessError extends AdapterOutputError {
  constructor(
    adapterId: string,
    message: string,
    readonly kind: FailureKind,
    readonly status?: number,
    readonly failure?: string,
    readonly usage?: Usage,
  ) {
    super(adapterId, message);
    this.name = "HarnessError";
  }
}

export function failureKindOf(error: unknown): FailureKind {
  return error instanceof HarnessError ? error.kind : "unknown";
}

/** The block phase's classifier, shared by every provider: budget reads as policy, as in the app. */
export function classifyHarnessError(error: unknown): ErrorKind {
  if (!(error instanceof HarnessError)) return "unknown";
  return error.kind === "budget" ? "policy" : error.kind;
}

export function makeHarnessError(adapterId: string): (kind: string, message: string, cause?: unknown) => Error {
  return (kind, message, cause) => {
    if (cause instanceof AdapterOutputError) return cause;
    // The pacing cap is the run's own stop signal, not a provider failure: it
    // passes through untouched so runPipeline lets it escape and the loop stops.
    if (cause instanceof PacingCapReached) return cause;
    const k: FailureKind = kind === "budget" ? "budget" : kind === "output" ? "output" : kind === "policy" ? "policy" : "provider";
    return new HarnessError(adapterId, `${kind}: ${message}`, k);
  };
}

/** Request bytes, measured the same way for every provider: the dspack request as the app would post it. */
export const requestBytes = (body: string): number => new TextEncoder().encode(body).length;
