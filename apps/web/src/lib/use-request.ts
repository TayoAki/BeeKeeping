import { useCallback, useRef, useState } from "react";

import { connectionLost } from "./auth-call.ts";

/**
 * One request at a time, for a form or a button. pending is true while it
 * runs, and a second submit meanwhile is ignored. The work returns the
 * message to show when it fails, or nothing. A thrown error, such as a
 * lost connection, shows the connection message, and pending always ends.
 */
export function useRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const running = useRef(false);

  const run = useCallback(
    async (work: () => Promise<string | undefined>): Promise<void> => {
      if (running.current) return;
      running.current = true;
      setPending(true);
      setError(undefined);
      try {
        const failure = await work();
        if (failure) setError(failure);
      } catch {
        setError(connectionLost);
      } finally {
        running.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { pending, error, run };
}
