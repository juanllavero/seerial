jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  fileSystemService: {},
}));
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

import { TMDbApiClient } from '@/api/v1/shared/infrastructure/adapters/metadata/TMDbApiClient';

describe('TMDbApiClient.getAPIKeyStatus', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockFetch = (success: boolean) => {
    const fetchMock = jest.fn().mockResolvedValue({ json: async () => ({ success }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it('asks TMDB once and remembers a valid key (clients check it on every page load)', async () => {
    const fetchMock = mockFetch(true);
    const client = new TMDbApiClient();
    client.THEMOVIEDB_API_TOKEN = 'key';

    expect(await client.getAPIKeyStatus()).toBe(true);
    expect(await client.getAPIKeyStatus()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checks again when the key changes, and never remembers an invalid key', async () => {
    const fetchMock = mockFetch(false);
    const client = new TMDbApiClient();
    client.THEMOVIEDB_API_TOKEN = 'bad';

    expect(await client.getAPIKeyStatus()).toBe(false);
    expect(await client.getAPIKeyStatus()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const validFetch = mockFetch(true);
    client.THEMOVIEDB_API_TOKEN = 'good';
    expect(await client.getAPIKeyStatus()).toBe(true);
    client.THEMOVIEDB_API_TOKEN = 'other';
    await client.getAPIKeyStatus();
    expect(validFetch).toHaveBeenCalledTimes(2);
  });

  it('reports an invalid key (instead of throwing) when TMDB cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    const client = new TMDbApiClient();
    client.THEMOVIEDB_API_TOKEN = 'key';

    expect(await client.getAPIKeyStatus()).toBe(false);
  });
});
