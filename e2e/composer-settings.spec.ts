import { expect, test, type Page } from "@playwright/test";

/**
 * Provider configuration — the only path a bring-your-own-inference user takes,
 * and until now covered by nothing.
 *
 * The browser is deliberately not the client of the model: it cannot reach
 * `localhost`, so the local agent is the bridge and it owns the endpoint and any
 * secret. That shape is what these specs pin — configuration reaches a real
 * endpoint through the real agent, discovery is real, a failure says what
 * happened, and a credential typed here never lands in browser storage.
 *
 * The endpoint is e2e/serve-provider.mjs: a real HTTP server speaking Ollama's
 * and OpenAI's discovery protocols. It generates nothing, and no spec here runs
 * a build against it — configuration is the surface under test, and a model call
 * would not be honest in CI.
 *
 * The agent-ABSENT half of this surface lives where it is true by construction:
 * composer-prod-smoke.spec.ts, which runs with no agent at all.
 */

const FIXTURE = "http://localhost:3314";
/** Must match EXPECTED_KEY in e2e/serve-provider.mjs. */
const FIXTURE_KEY = "sk-fixture-credential-0123456789";
/** Nothing listens here — the honest "unreachable endpoint" case. */
const DEAD_ENDPOINT = "http://localhost:3399";

async function openSettings(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("nav-settings").click();
  // Local configuration is gated on the bridge being there; wait for the probe
  // rather than for a timer.
  await expect(page.getByTestId("agent-status")).toContainText("Agent connected");
  await expect(page.getByTestId("local-onboarding")).toHaveCount(0);
}

test("Ollama: a real connection test discovers the models, and choosing one configures the provider for Build", async ({ page }) => {
  await openSettings(page);

  await page.getByTestId("ollama-url").fill(FIXTURE);
  await page.getByTestId("ollama-test").click();

  // Discovery is the agent's, over a real socket: two usable models, with the
  // embedding model filtered out on the way through.
  const status = page.getByTestId("ollama-status");
  await expect(status).toContainText("Connected — 2 models");
  await expect(page.getByTestId("ollama-models")).not.toContainText("fixture-embedding");
  await expect(page.getByTestId("ollama-model-fixture-coder:7b")).toBeVisible();

  // Choosing a model IS the configuration step.
  await page.getByTestId("ollama-model-fixture-coder:7b").click();
  await expect(page.getByTestId("active-provider")).toContainText("Local · fixture-coder:7b (ollama)");
  await expect(page.getByTestId("ollama-model-fixture-coder:7b")).toHaveAttribute("aria-pressed", "true");

  // It persists as a preference — endpoint and model, no secret — and the form
  // reopens on what was configured.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("composer.providers.v1") ?? "null"));
  expect(stored).toMatchObject({ ollama: { baseUrl: FIXTURE, model: "fixture-coder:7b" }, active: "ollama:fixture-coder:7b" });
  await page.reload();
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("ollama-url")).toHaveValue(FIXTURE);
  await expect(page.getByTestId("active-provider")).toContainText("fixture-coder:7b");

  // And it reaches the place it matters: a project opens with that provider
  // already selected, named honestly in the privacy line.
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-project-name").fill("Bring your own model");
  await page.getByTestId("new-source-shadcn").click();
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("build-model")).toHaveValue("ollama:fixture-coder:7b");
  await expect(page.getByTestId("build-privacy")).toContainText("ollama:fixture-coder:7b");
});

test("OpenAI-compatible: a base URL discovers models, and an endpoint that lists none falls back to typing one", async ({ page }) => {
  await openSettings(page);

  await page.getByTestId("openai-url").fill(`${FIXTURE}/v1`);
  await page.getByTestId("openai-test").click();
  await expect(page.getByTestId("openai-status")).toContainText("Connected — 2 models");
  await page.getByTestId("openai-model-fixture-openai-b").click();
  await expect(page.getByTestId("active-provider")).toContainText("Local · fixture-openai-b (openai)");

  // Plenty of local servers don't implement /models. Reachable-but-unlistable is
  // not a failure: the UI asks for the model id instead of inventing one.
  await expect(page.getByTestId("openai-manual")).toHaveCount(0);
  await page.getByTestId("openai-url").fill(`${FIXTURE}/silent`);
  await page.getByTestId("openai-test").click();
  await expect(page.getByTestId("openai-status")).toContainText("Connected");
  await expect(page.getByTestId("openai-status")).not.toContainText("model");
  const manual = page.getByTestId("openai-manual");
  await expect(manual).toContainText("doesn’t list models");
  await expect(page.getByTestId("openai-model-use")).toBeDisabled();

  await page.getByTestId("openai-model-input").fill("hand-typed-model");
  await page.getByTestId("openai-model-use").click();
  await expect(page.getByTestId("active-provider")).toContainText("Local · hand-typed-model (openai)");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("composer.providers.v1") ?? "null"));
  expect(stored).toMatchObject({ openai: { baseUrl: `${FIXTURE}/silent`, model: "hand-typed-model" } });
});

test("a failed connection test says what happened and configures nothing", async ({ page }) => {
  await openSettings(page);

  // First configure something real, so the failure has something to NOT undo.
  await page.getByTestId("ollama-url").fill(FIXTURE);
  await page.getByTestId("ollama-test").click();
  await page.getByTestId("ollama-model-fixture-small:1b").click();
  await expect(page.getByTestId("active-provider")).toContainText("fixture-small:1b");

  await page.getByTestId("ollama-url").fill(DEAD_ENDPOINT);
  await page.getByTestId("ollama-test").click();

  // The endpoint's own failure, in plain words — not a stack trace, not silence.
  const status = page.getByTestId("ollama-status");
  await expect(status).toContainText("is the server running at that address?");
  await expect(page.getByTestId("ollama-models")).toHaveCount(0);

  // Nothing was reconfigured by a failure.
  await expect(page.getByTestId("active-provider")).toContainText("fixture-small:1b");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("composer.providers.v1") ?? "null"));
  expect(stored.ollama).toEqual({ baseUrl: FIXTURE, model: "fixture-small:1b" });
});

test("a credential is used by the agent and never written to browser storage", async ({ page }) => {
  await openSettings(page);

  // The endpoint requires a key. Without one it refuses, and the refusal is
  // reported as the endpoint's, not swallowed.
  await page.getByTestId("openai-url").fill(`${FIXTURE}/keyed`);
  await page.getByTestId("openai-test").click();
  await expect(page.getByTestId("openai-status")).toContainText("401");
  await expect(page.getByTestId("openai-models")).toHaveCount(0);

  // With the key, the SAME endpoint answers — which is only possible if the
  // exact credential travelled browser → agent → provider. The fixture rejects
  // anything else, so this is a real end-to-end proof, not a rendering check.
  await page.getByTestId("openai-key").fill(FIXTURE_KEY);
  await page.getByTestId("openai-test").click();
  await expect(page.getByTestId("openai-status")).toContainText("Connected — 1 model");
  await page.getByTestId("openai-model-credentialed-model").click();
  await expect(page.getByTestId("active-provider")).toContainText("Local · credentialed-model (openai)");

  // THE INVARIANT: the browser is a client, not a vault. Configuring a provider
  // persists the endpoint and the model; the credential exists only in memory
  // for the session, so nothing durable in this browser holds it.
  const dump = await page.evaluate(() => {
    const read = (s: Storage) => Object.fromEntries(Object.keys(s).map((k) => [k, s.getItem(k) ?? ""]));
    return { local: read(localStorage), session: read(sessionStorage) };
  });
  expect(JSON.stringify(dump)).not.toContain(FIXTURE_KEY);
  expect(JSON.stringify(dump)).not.toContain("sk-");
  expect(JSON.parse(dump.local["composer.providers.v1"])).toMatchObject({
    openai: { baseUrl: `${FIXTURE}/keyed`, model: "credentialed-model" },
    active: "openai:credentialed-model",
  });
  expect(dump.local["composer.providers.v1"]).not.toContain("apiKey");

  // A reload keeps the configuration and drops the secret — the honest cost of
  // never storing it, and the UI's stated contract.
  await page.reload();
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("active-provider")).toContainText("credentialed-model");
  await expect(page.getByTestId("openai-key")).toHaveValue("");
});
