/**
 * The build-time flag (Phase 1A, commit 5). A default build is byte-identical
 * to today's and carries no block code; an experimental build is a sibling
 * artifact that can never be production's deploy artifact. The config enforces both:
 * the flag is inlined as "0" or "1" (an unset variable would stay a runtime
 * read), the experimental directory is aliased away unless the flag is on,
 * and the flag and the output directory must agree, or the build throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config.mjs";

const PRODUCTION = "phase-production-build";
const resolved = (phase, env) => {
  vi.stubEnv("NEXT_PUBLIC_COMPOSER_EXPERIMENTAL", env.flag ?? "");
  vi.stubEnv("COMPOSER_OUT_DIR", env.outDir ?? "");
  return nextConfig(phase);
};

afterEach(() => vi.unstubAllEnvs());

describe("next.config: the experimental flag and the output directory", () => {
  it("is a function of the build phase", () => {
    expect(typeof nextConfig).toBe("function");
  });

  it("default build: the flag is inlined as '0', the output is out/, and the experimental directory is aliased away", () => {
    const config = resolved(PRODUCTION, {});
    expect(config.env).toEqual({ NEXT_PUBLIC_COMPOSER_EXPERIMENTAL: "0" });
    expect(config).not.toHaveProperty("distDir");
    const webpack = config.webpack({ resolve: {}, plugins: [] }, { webpack: { NormalModuleReplacementPlugin: class {} } });
    const aliases = Object.entries(webpack.resolve.alias).filter(([, v]) => v === false).map(([k]) => k);
    expect(aliases.some((k) => k.endsWith("/experimental"))).toBe(true);
  });

  it("experimental build: the flag is inlined as '1', the output is out-experimental/, and nothing is aliased away", () => {
    const config = resolved(PRODUCTION, { flag: "1", outDir: "out-experimental" });
    expect(config.env).toEqual({ NEXT_PUBLIC_COMPOSER_EXPERIMENTAL: "1" });
    expect(config.distDir).toBe("out-experimental");
    const webpack = config.webpack({ resolve: {}, plugins: [] }, { webpack: { NormalModuleReplacementPlugin: class {} } });
    expect(Object.values(webpack.resolve.alias)).not.toContain(false);
  });

  it("the flag without the experimental output directory throws, so the deploy artifact can never carry block code", () => {
    expect(() => resolved(PRODUCTION, { flag: "1" })).toThrow(/out-experimental/);
    expect(() => resolved(PRODUCTION, { flag: "1", outDir: "out" })).toThrow(/out-experimental/);
  });

  it("the experimental output directory without the flag throws, and any other directory is refused", () => {
    expect(() => resolved(PRODUCTION, { outDir: "out-experimental" })).toThrow(/NEXT_PUBLIC_COMPOSER_EXPERIMENTAL/);
    expect(() => resolved(PRODUCTION, { flag: "1", outDir: "../elsewhere" })).toThrow(/COMPOSER_OUT_DIR/);
  });

  it("the dev server never throws over the flag; it only inlines it", () => {
    expect(resolved("phase-development-server", { flag: "1" }).env).toEqual({ NEXT_PUBLIC_COMPOSER_EXPERIMENTAL: "1" });
    expect(resolved("phase-development-server", {}).env).toEqual({ NEXT_PUBLIC_COMPOSER_EXPERIMENTAL: "0" });
  });
});
