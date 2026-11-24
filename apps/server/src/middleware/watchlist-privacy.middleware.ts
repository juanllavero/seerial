import type { NextFunction, Request, Response } from 'express';

/**
 * Removes from `body` every `watchLists` entry that does not belong to `userId`.
 * Watch lists hold what each user watched and how far, so a user only receives their own
 * (nested at any depth: movies, series, seasons, episodes, videos...). Done in place.
 */
export function keepOwnWatchLists(body: unknown, userId: string): void {
  const seen = new WeakSet<object>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];

      if (key === 'watchLists' && Array.isArray(value)) {
        record[key] = value.filter(
          (entry) => (entry as { userId?: unknown } | null)?.userId === userId,
        );
        continue;
      }

      visit(value);
    }
  };

  visit(body);
}

/**
 * Applies `keepOwnWatchLists` to every JSON response sent to an authenticated user, so no
 * endpoint (present or future) can leak the viewing activity of other users.
 *
 * Must be registered BEFORE RegisterRoutes so that res.json is wrapped before any handler uses it;
 * `req.user` is only known once the route authentication has run, which happens before the handler.
 */
export function watchListPrivacyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = (body: unknown) => {
    const userId = req.user?.id;
    if (userId) keepOwnWatchLists(body, userId);

    return originalJson(body);
  };

  next();
}
