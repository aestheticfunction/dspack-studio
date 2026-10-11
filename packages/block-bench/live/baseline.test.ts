/**
 * The production baseline (docs/blocks/BASELINE.md) costs no model call and records only what it observed. Each
 * test runs the real baseline CLI as its own process, as pnpm runs it (cwd the package, INIT_CWD where the owner
 * typed the command), against the REAL Worker entry served on localhost: a fake asset layer serves a static export
 * and the model binding counts calls.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "../../../apps/composer/worker/index.mjs";
import { readBuildId } from "./preflight";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const BUILD = "oSDoH1hVOcc4ziVTWQPTG";
/** The app router's static export names no build manifest in its HTML: the id rides in the flight payload (as in apps/composer/out/index.html). */
const APP_ROUTER_HTML = `<!DOCTYPE html><html><head><script src="/_next/static/chunks/webpack-1.js" async=""></script></head><body><script>self.__next_f.push([1,"0:{\\"P\\":null,\\"b\\":\\"${BUILD}\\",\\"p\\":\\"\\",\\"c\\":[\\"\\",\\"\\"],\\"i\\":false}\\n"])</script></body></html>`;
const EXPORT: Record<string, string> = { "/index.html": APP_ROUTER_HTML, [`/_next/static/${BUILD}/_buildManifest.js`]: "self.__BUILD_MANIFEST={};" };

/** The real Worker over an asset layer of `files`; every request and every model call is counted. */
function deployment(files: Record<string, string>) {
  const requests: string[] = [];
  let modelCalls = 0;
  const env = {
    HOSTED_AI: "on",
    AI: {
      run: async () => {
        modelCalls += 1;
        throw new Error("a model was called");
      },
    },
    ASSETS: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        const body = files[path === "/" ? "/index.html" : path];
        return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
      },
    },
  };
  const handle = async (request: Request) => {
    const body = request.method === "POST" ? await request.clone().text() : "";
    requests.push(`${request.method} ${new URL(request.url).pathname}${body ? ` ${body}` : ""}`);
    return (worker as { fetch(request: Request, env: unknown): Promise<Response> }).fetch(request, env);
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => handle(new Request(input, init))) as typeof fetch;
  return { handle, fetchImpl, requests, modelCalls: () => modelCalls };
}

describe("the deployed build id", () => {
  it("is read from the app router's flight payload and confirmed against the build's own static manifest", async () => {
    expect(await readBuildId("https://composer.example", deployment(EXPORT).fetchImpl)).toBe(BUILD);
    // An id the deployment does not serve a build for is not the deployed build.
    expect(await readBuildId("https://composer.example", deployment({ "/index.html": APP_ROUTER_HTML }).fetchImpl)).toBeNull();
    // The pages router's manifest reference is still read.
    const pages = deployment({ "/index.html": `<script src="/_next/static/${BUILD}/_buildManifest.js" defer=""></script>`, [`/_next/static/${BUILD}/_buildManifest.js`]: "x" });
    expect(await readBuildId("https://composer.example", pages.fetchImpl)).toBe(BUILD);
    expect(await readBuildId("https://composer.example", deployment({ "/index.html": "<html></html>" }).fetchImpl)).toBeNull();
  });
});

describe("pnpm --filter @dspack-studio/block-bench baseline", () => {
  const live = deployment(EXPORT);
  let server: Server;
  let origin: string;
  let invoked: string;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const response = await live.handle(new Request(`${origin}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(hasBody ? { body: Buffer.concat(chunks) } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    invoked = mkdtempSync(join(tmpdir(), "block-bench-baseline-"));
    mkdirSync(join(invoked, "docs/blocks"), { recursive: true });
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(invoked, { recursive: true, force: true });
  });

  /** The CLI as pnpm runs it: cwd the package directory, INIT_CWD the directory the command was typed in. */
  const baseline = (args: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", "live/baseline.ts", ...args], {
        cwd: PACKAGE_DIR,
        env: { ...process.env, INIT_CWD: invoked, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });

  it("writes the record where the owner asked, with only zero-cost requests and no model call", async () => {
    const run = await baseline(["--base-url", origin, "--out", "docs/blocks/baseline.json"]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(live.modelCalls()).toBe(0);
    expect(live.requests).toEqual(["POST /api/propose {}", "GET /", `GET /_next/static/${BUILD}/_buildManifest.js`, "GET /api/models"]);
    const file = join(invoked, "docs/blocks/baseline.json");
    expect(existsSync(join(PACKAGE_DIR, "docs/blocks/baseline.json"))).toBe(false);
    const record = JSON.parse(readFileSync(file, "utf8"));
    expect(record).toMatchObject({ baseUrl: origin, buildId: BUILD, worker: { shape: "phase-0.5", status: 400, error: "invalid-request", calls: [] }, models: ["scripted", "hosted-ai"], drafts: true });
    expect(Number.isNaN(Date.parse(record.at))).toBe(false);
    expect(run.stdout).toContain(`baseline: wrote ${file}`);
  }, 60_000);

  it("writes nothing when the deployment cannot be read whole, and says why", async () => {
    // An absolute path, so only the record's completeness decides whether it is written.
    const file = join(invoked, "docs/blocks/partial.json");
    const run = await baseline(["--base-url", "http://127.0.0.1:9", "--out", file]);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/not written: the Worker at http:\/\/127\.0\.0\.1:9 is unreachable/);
    expect(existsSync(file)).toBe(false);
  }, 60_000);

  it("refuses an unknown option or a missing value before any request", async () => {
    const before = live.requests.length;
    const unknown = await baseline(["--base-url", origin, "--bogus"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toMatch(/unknown option '--bogus'/);
    const missing = await baseline(["--base-url", origin, "--out"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/--out needs a value/);
    expect(live.requests.length).toBe(before);
  }, 60_000);
});
