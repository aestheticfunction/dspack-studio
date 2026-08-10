import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { webstorageEnv } from "./next-dev.mjs";

/**
 * The quick-start regression guard: `pnpm --filter composer dev` must work on
 * EVERY engines-supported Node. Node < 22.4 rejects --localstorage-file in
 * NODE_OPTIONS with exit 9 (reproduced on a real v22.0.0 binary), so the flag
 * may never sit inline in a package script — only the version-probing
 * launcher may add it, and only where this Node allows it.
 */
describe("next-dev launcher (quick-start regression)", () => {
  it("no package script hardcodes --localstorage-file in NODE_OPTIONS", () => {
    for (const rel of ["../package.json", "../../web/package.json"]) {
      const pkg = JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
      for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
        expect(script, `${pkg.name} ${name}`).not.toMatch(/NODE_OPTIONS=.*--localstorage-file/);
      }
    }
  });

  it("old Node (flag not allowed): env passes through untouched — no exit-9 bomb", () => {
    const env = webstorageEnv({ PATH: "/bin" }, new Set(["--max-old-space-size"]));
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });

  it("new Node (flag allowed): the SSR protection is applied", () => {
    const env = webstorageEnv({}, new Set(["--localstorage-file"]));
    expect(env.NODE_OPTIONS).toBe("--localstorage-file=/tmp/dspack-composer-dev-localstorage");
  });

  it("preserves a caller's existing NODE_OPTIONS", () => {
    const env = webstorageEnv({ NODE_OPTIONS: "--max-old-space-size=4096" }, new Set(["--localstorage-file"]));
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=4096 --localstorage-file=/tmp/dspack-composer-dev-localstorage");
  });

  it("the RUNNING Node agrees with its own probe (sanity)", () => {
    const env = webstorageEnv({}, process.allowedNodeEnvironmentFlags);
    const has = process.allowedNodeEnvironmentFlags.has("--localstorage-file");
    expect(!!env.NODE_OPTIONS).toBe(has);
  });
});
