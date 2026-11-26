import { useEffect, useRef, useState } from 'react';

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | undefined)?.then === 'function';

/**
 * Wraps a click handler that may return a promise (a call to an endpoint). While the promise is
 * pending `pending` is true and further calls are ignored, so the action cannot be sent twice.
 * Handlers that do not return a promise behave as usual.
 */
export function usePendingAction<TEvent extends { preventDefault: () => void }>(
  handler: ((event: TEvent) => unknown) | undefined,
  blocked = false,
) {
  const [pending, setPending] = useState(false);
  // The state is only updated after render, the ref blocks a second click in the same frame
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = (event: TEvent) => {
    if (running.current || blocked) {
      event.preventDefault();
      return;
    }

    const result = handler?.(event);
    if (!isPromiseLike(result)) return;

    running.current = true;
    setPending(true);
    const finish = () => {
      running.current = false;
      if (mounted.current) setPending(false);
    };
    // A rejection keeps reaching the console as before: only the waiting state is cleaned up
    Promise.resolve(result).finally(finish).catch(() => undefined);
  };

  return { pending: pending || blocked, run };
}
