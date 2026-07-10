/**
 * SSE encoding for the agent server, wrapped here so apps never import
 * @ag-ui/* directly (the studio's import-isolation rule). The EventEncoder
 * handles AG-UI's content negotiation (SSE JSON default; protobuf when the
 * client sends the AG-UI proto Accept header).
 */
import { EventEncoder } from "@ag-ui/encoder";
import type { BaseEvent } from "@ag-ui/core";

export interface SseEncoder {
  contentType: string;
  encode(event: BaseEvent): string;
}

export function createSseEncoder(acceptHeader?: string): SseEncoder {
  // Only negotiate the protobuf encoding when the client asks for it BY NAME.
  // A wildcard Accept (curl's default */*) would otherwise match proto and
  // mislabel the SSE-JSON body.
  const wantsProto = acceptHeader?.includes("application/vnd.ag-ui.event+proto") ?? false;
  const encoder = new EventEncoder(wantsProto ? { accept: acceptHeader } : {});
  return {
    contentType: encoder.getContentType(),
    encode: (event) => encoder.encodeSSE(event),
  };
}
