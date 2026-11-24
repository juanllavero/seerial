import express from 'express';
import request from 'supertest';
import {
  keepOwnWatchLists,
  watchListPrivacyMiddleware,
} from '@/middleware/watchlist-privacy.middleware';

const watchLists = () => [
  { id: 'w1', userId: 'alice', watched: true, timeWatched: 10 },
  { id: 'w2', userId: 'bob', watched: false, timeWatched: 99 },
];

describe('keepOwnWatchLists', () => {
  it('keeps only the watch lists of the user, at any depth', () => {
    const series = {
      id: 's',
      watchLists: watchLists(),
      seasons: [
        {
          id: 'se',
          watchLists: watchLists(),
          episodes: [{ id: 'e', video: { id: 'v', watchLists: watchLists() } }],
        },
      ],
    };

    keepOwnWatchLists(series, 'alice');

    expect(series.watchLists.map((w) => w.userId)).toEqual(['alice']);
    expect(series.seasons[0].watchLists.map((w) => w.userId)).toEqual(['alice']);
    expect(series.seasons[0].episodes[0].video.watchLists.map((w) => w.userId)).toEqual(['alice']);
  });

  it('empties the list when the user has no entry, and works on arrays and extras', () => {
    const payload = {
      data: [
        { id: 'm1', watchLists: watchLists(), extras: [{ id: 'x', watchLists: watchLists() }] },
      ],
    };

    keepOwnWatchLists(payload, 'carol');

    expect(payload.data[0].watchLists).toEqual([]);
    expect(payload.data[0].extras[0].watchLists).toEqual([]);
  });

  it('leaves everything else untouched and tolerates cycles and primitives', () => {
    const node: Record<string, unknown> = { id: 'a', name: 'x', tags: ['t'] };
    node.self = node;

    expect(() => keepOwnWatchLists(node, 'alice')).not.toThrow();
    expect(node.name).toBe('x');
    expect(() => keepOwnWatchLists(null, 'alice')).not.toThrow();
    expect(() => keepOwnWatchLists('text', 'alice')).not.toThrow();
  });
});

describe('watchListPrivacyMiddleware', () => {
  const buildApp = (userId: string | undefined) => {
    const app = express();
    app.use(watchListPrivacyMiddleware);
    // Route authentication runs before the handler and sets req.user
    app.use((req, _res, next) => {
      if (userId) (req as unknown as { user: { id: string } }).user = { id: userId };
      next();
    });
    app.get('/movie', (_req, res) => {
      res.json({ success: true, data: { id: 'm', videos: [{ id: 'v', watchLists: watchLists() }] } });
    });
    return app;
  };

  it("sends each user only their own watch lists", async () => {
    const alice = await request(buildApp('alice')).get('/movie');
    const bob = await request(buildApp('bob')).get('/movie');

    expect(alice.body.data.videos[0].watchLists).toEqual([watchLists()[0]]);
    expect(bob.body.data.videos[0].watchLists).toEqual([watchLists()[1]]);
  });

  it('strips them for administrators too', async () => {
    const res = await request(buildApp('root')).get('/movie');

    expect(res.body.data.videos[0].watchLists).toEqual([]);
  });

  it('does not touch unauthenticated responses', async () => {
    const res = await request(buildApp(undefined)).get('/movie');

    expect(res.body.data.videos[0].watchLists).toHaveLength(2);
  });
});
