/**
 * A local model's unusable output never reaches a durable record. dspack-gen
 * appends the head of a non-JSON output to its error message; the harness
 * keeps the message and drops the model's text, so a failure the run log
 * records (plan.failure, failure, a block trace's providerError) holds the
 * diagnosis, not the answer.
 */
import { describe, expect, it } from "vitest";
import { createCallRecorder } from "@dspack-studio/composer-core";
import { runCell } from "./arms";
import { promptsFor, readCorpus } from "./corpus";
import { createOllamaProvider } from "./providers/ollama";
import { HarnessError, createMeter } from "./providers/types";
import { loadReference } from "./references";

const PROSE = "PROSE-THE-MODEL-WROTE instead of the JSON it was asked for";
const chat = (async () => new Response(JSON.stringify({ model: "gpt-oss:latest", message: { content: PROSE }, prompt_eval_count: 10, eval_count: 5 }))) as unknown as typeof fetch;

describe("an unusable local-model output", () => {
  it("fails as an output failure whose message keeps dspack-gen's diagnosis and none of the model's text", async () => {
    const provider = createOllamaProvider({ model: "gpt-oss:latest", host: "http://127.0.0.1:9", fetchImpl: chat });
    const error = await provider.plan({ system: "s", messages: [{ role: "user", content: "u" }], jsonSchema: { type: "object" } }, { recorder: createCallRecorder(), meter: createMeter() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HarnessError);
    expect((error as HarnessError).kind).toBe("output");
    expect((error as HarnessError).message).toMatch(/not valid JSON/);
    expect((error as HarnessError).message).not.toContain("PROSE-THE-MODEL-WROTE");
  });

  it("leaves no trace of the model's text in the cell's record", async () => {
    const corpus = readCorpus();
    const astryx = await loadReference("astryx");
    const provider = createOllamaProvider({ model: "gpt-oss:latest", host: "http://127.0.0.1:9", fetchImpl: chat });
    const prompt = promptsFor(corpus, "astryx").find((p) => p.id === "rt-01")!;
    const { record } = await runCell({ reference: astryx, provider, arm: "production", condition: "fresh", prompt, corpus });
    expect(record).toMatchObject({ outcome: "failed-adapter", failure: { kind: "output" }, plan: { failure: { kind: "output" } } });
    expect(JSON.stringify(record)).not.toContain("PROSE-THE-MODEL-WROTE");
  }, 60_000);
});
