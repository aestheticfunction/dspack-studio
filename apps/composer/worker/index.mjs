/**
 * Composer Worker — entry point.
 *
 * The Composer is and remains STATIC-FIRST. `assets.run_worker_first` is scoped
 * to `/api/*`, so ordinary requests never reach this code — the asset layer
 * answers them directly, exactly as the pre-Worker deploy did. Setting `main`
 * does mean a path with no matching asset now falls through to the Worker, so
 * every non-API request is handed straight back to the asset binding, which
 * reproduces the previous behaviour (including the 404 page) byte-for-byte.
 *
 * The only thing this Worker adds is one governed API namespace:
 *   POST /api/propose  → the nondeterministic proposal via the AI Gateway
 *   GET  /api/models   → which hosted models are available (capability probe)
 * Unknown /api/* paths answer as JSON here rather than falling through to an
 * HTML page — a client expecting JSON must never be handed a 404 marketing page.
 */
import { handlePropose, handleModels } from "./propose.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/propose") return handlePropose(request, env);
    if (url.pathname === "/api/models") return handleModels(env);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "not-found", message: "No such endpoint." }) + "\n", {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // Everything else: back to the asset layer, unchanged.
    return env.ASSETS.fetch(request);
  },
};
