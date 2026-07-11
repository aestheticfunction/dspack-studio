"use client";

/**
 * One-shot agent reachability probe for the studio shell: the view switcher
 * marks the modes that need the local agent when it is not there. LiveView
 * and BreakView keep their own richer status via useLiveRun.
 */
import { useEffect, useState } from "react";

export function useAgentStatus(agentUrl: string): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(agentUrl, { signal: AbortSignal.timeout(2000) })
      .then((r) => {
        if (alive) setOnline(r.ok);
      })
      .catch(() => {
        if (alive) setOnline(false);
      });
    return () => {
      alive = false;
    };
  }, [agentUrl]);
  return online;
}
