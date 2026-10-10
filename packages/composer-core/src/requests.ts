/**
 * The exact bytes Composer sends, built in ONE place.
 *
 * Extracted (byte-identical) from apps/composer/app/state.tsx and
 * apps/composer/app/hosted-build.ts so the bench's request goldens hash what
 * the app actually sends, not a re-implementation of it. They are the
 * flag-off byte-identity oracle for every later change (docs/BLOCKS.md):
 * if either function's output moves, the goldens move with it, visibly.
 */

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/** The refinement seed: the prior turn's goal and its complete prior surface. */
export function refinementConversation(priorPrompt: string, priorSurface: unknown): ConversationTurn[] {
  return [
    { role: "user", content: priorPrompt },
    { role: "assistant", content: JSON.stringify(priorSurface) },
  ];
}

/**
 * The /api/propose request body, exactly as the gateway adapter posts it.
 * `maxCalls` caps the Worker's provider calls for this request (1 disables
 * its parse retry). Absent, the bytes are exactly today's.
 */
export function proposeBody(
  request: { system: string; messages: unknown[]; jsonSchema: unknown },
  options: { maxCalls?: 1 | 2 } = {},
): string {
  return JSON.stringify({
    system: request.system,
    messages: request.messages,
    jsonSchema: request.jsonSchema,
    ...(options.maxCalls !== undefined ? { maxCalls: options.maxCalls } : {}),
  });
}
