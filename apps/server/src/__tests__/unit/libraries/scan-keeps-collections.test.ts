jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() },
}));
jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  useCases: {},
  notificationService: { broadcast: jest.fn(), mutateLibrary: jest.fn() },
}));
jest.mock('@/api/v1/shared/infrastructure/services/TrackSelectionService', () => ({
  TrackSelectionService: { applyToLibrary: jest.fn() },
}));

import { scanQueue } from '@/api/v1/libraries/application/services/ScanQueue';
import { ScanLibraryUseCase } from '@/api/v1/libraries/application/usecases/ScanLibraryUseCase';

const { useCases } = jest.requireMock('@/api/v1/shared/infrastructure/adapters/di/container');

const collections: Record<string, { movies: unknown[]; shows: unknown[]; albums: unknown[] }> = {
  movies: { movies: [{}, {}], shows: [], albums: [] },
  series: { movies: [], shows: [{}], albums: [] },
  music: { movies: [], shows: [], albums: [{}] },
  empty: { movies: [], shows: [], albums: [] },
};

describe('collections when a library is scanned again', () => {
  it.each(['Movies', 'Shows'])('only removes the empty ones (%s)', async (type) => {
    const deleteCollection = jest.fn();
    Object.assign(useCases, {
      getAllCollectionsInLibrary: () => ({
        execute: async () => Object.keys(collections).map((id) => ({ id })),
      }),
      getCollectionById: () => ({ execute: async (id: string) => collections[id] }),
      deleteCollection: () => ({ execute: deleteCollection }),
      getMovies: () => ({ execute: async () => [] }),
      getSeries: () => ({ execute: async () => [] }),
    });

    const library = {
      id: 'lib',
      name: 'Library',
      type,
      folders: ['H:/Library'],
      analyzedFiles: {},
      analyzedFolders: {},
    };
    const files = { isFolder: async () => true, getFilesInFolder: async () => [] };
    const libraries = { getById: async () => library, update: jest.fn() };

    await new ScanLibraryUseCase(files as never, libraries as never).execute(
      library as never,
      false,
    );
    await scanQueue.idle();

    // A removed collection is created again by the scan without its custom order
    expect(deleteCollection.mock.calls).toEqual([['empty']]);
  });
});
