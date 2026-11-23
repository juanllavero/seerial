// CommonJS shim for p-limit that provides the same concurrency-limiting behavior.
// Needed because p-limit@7 is pure-ESM and Jest runs in CommonJS mode.
function pLimit(concurrency) {
  const queue = [];
  let active = 0;

  const next = () => {
    active--;
    if (queue.length > 0) {
      queue.shift()();
    }
  };

  const run = async (fn, resolve, args) => {
    active++;
    const result = (async () => fn(...args))();
    resolve(result);
    try {
      await result;
    } catch {
      // The rejection is surfaced through the promise returned to the caller.
    }
    next();
  };

  const limit = (fn, ...args) =>
    new Promise((resolve) => {
      const start = run.bind(undefined, fn, resolve, args);
      if (active < concurrency) {
        start();
      } else {
        queue.push(start);
      }
    });

  Object.defineProperties(limit, {
    activeCount: { get: () => active },
    pendingCount: { get: () => queue.length },
    concurrency: { get: () => concurrency },
  });

  return limit;
}

module.exports = pLimit;
module.exports.default = pLimit;
