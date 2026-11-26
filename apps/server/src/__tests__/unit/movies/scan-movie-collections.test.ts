jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() },
}));
jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  downloaderService: { autoDownloadFirstAudioResult: jest.fn() },
}));
jest.mock('@/api/v1/shared/infrastructure/adapters/ffmpeg/mediaInfo', () => ({
  getMediaInfo: jest.fn(),
  getOnlyRuntime: jest.fn().mockResolvedValue(0),
}));

import { ScanMovieUseCase } from '@/api/v1/movies/application/usecases/ScanMovieUseCase';

describe('ScanMovieUseCase: collection folders', () => {
  const build = () => {
    const root = 'H:/UHD/Alien';
    const folders = [`${root}/Alien (1979)`, `${root}/Aliens (1986)`];
    const files: Record<string, { name: string; isDir: boolean }[]> = {
      [root]: folders.map((f) => ({ name: f.split('/').pop() as string, isDir: true })),
      [folders[0]]: [{ name: 'Alien (1979).mkv', isDir: false }],
      [folders[1]]: [{ name: 'Aliens (1986).mkv', isDir: false }],
    };

    const filesManager = {
      isFolder: jest.fn(async (p: string) => p in files),
      isVideoFile: jest.fn((p: string) => p.endsWith('.mkv')),
      getFilesInFolder: jest.fn(async (p: string) =>
        (files[p] ?? []).map((f) => ({ name: f.name, isDirectory: () => f.isDir, parentPath: p })),
      ),
      getValidVideoFiles: jest.fn(async () => []),
    };
    const movies = new Map<string, { id: string; name: string }>();
    const movieRepository = {
      findById: jest.fn(async (id: string) => movies.get(id) ?? null),
      create: jest.fn(async (data: { folder: string }) => {
        const movie = { id: `m${movies.size + 1}`, name: '', ...data };
        movies.set(movie.id, movie);
        return movie;
      }),
      update: jest.fn(async (_id: string, _data: unknown) => ({})),
    };
    const collectionRepo = {
      getByName: jest.fn(async () => null),
      add: jest.fn(async (c: { title: string }) => ({ id: 'coll1', ...c })),
      addLibrary: jest.fn(async () => {}),
      addMovie: jest.fn(async (_collectionId: string, _movieId: string) => {}),
    };
    const librariesRepo = {
      addAnalyzedFolder: jest.fn(async () => {}),
      addAnalyzedFile: jest.fn(async () => {}),
      getById: jest.fn(async () => null),
      update: jest.fn(async () => {}),
    };
    const videoRepo = {
      findById: jest.fn(async () => null),
      addAsMovie: jest.fn(async () => ({ id: 'v1', runtime: 100, mediaInfo: {}, videoTracks: [{}] })),
      addAsMovieExtra: jest.fn(),
      update: jest.fn(async () => {}),
    };
    const metadataProvider = {
      searchMovies: jest.fn(async () => []),
      updateMovieMetadata: jest.fn(),
      updateVideoMetadataForMovie: jest.fn(),
    };
    const notificationService = { mutateLibrary: jest.fn(), mutateMovie: jest.fn() };

    const useCase = new ScanMovieUseCase(
      filesManager as never,
      librariesRepo as never,
      movieRepository as never,
      videoRepo as never,
      collectionRepo as never,
      metadataProvider as never,
      notificationService as never,
    );
    const library = { id: 'lib', name: 'UHD', language: 'es', analyzedFiles: {}, analyzedFolders: {} };
    return { useCase, library, root, folders, movies, movieRepository, collectionRepo };
  };

  it('links every movie of the folder to its collection', async () => {
    const { useCase, library, root, collectionRepo } = build();

    await useCase.execute(library as never, root);

    expect(collectionRepo.add).toHaveBeenCalledWith({ title: 'Alien' });
    expect(collectionRepo.addMovie).toHaveBeenCalledTimes(2);
    expect(collectionRepo.addMovie).toHaveBeenCalledWith('coll1', 'm1');
    expect(collectionRepo.addMovie).toHaveBeenCalledWith('coll1', 'm2');
  });

  it('does not bring back the folder collection for movies moved to another one', async () => {
    const { useCase, library, root, folders, movies, collectionRepo } = build();
    folders.forEach((folder, i) => {
      const movie = { id: `m${i}`, name: 'Alien', collectionId: 'mine' };
      movies.set(movie.id, movie);
      Object.assign(library.analyzedFolders, { [folder]: movie.id });
    });

    await useCase.execute(library as never, root);

    expect(collectionRepo.add).not.toHaveBeenCalled();
    expect(collectionRepo.addMovie).not.toHaveBeenCalled();
  });

  it('links the movie after saving it: saving the whole movie used to erase the link', async () => {
    const { useCase, library, root, movieRepository, collectionRepo } = build();

    await useCase.execute(library as never, root);

    for (const call of collectionRepo.addMovie.mock.invocationCallOrder.keys()) {
      const linkedAt = collectionRepo.addMovie.mock.invocationCallOrder[call];
      const movieId = collectionRepo.addMovie.mock.calls[call][1];
      const savesOfThisMovie = movieRepository.update.mock.calls
        .map((args, i) => ({ id: args[0], at: movieRepository.update.mock.invocationCallOrder[i] }))
        .filter((save) => save.id === movieId);

      expect(savesOfThisMovie.length).toBeGreaterThan(0);
      expect(Math.max(...savesOfThisMovie.map((save) => save.at))).toBeLessThan(linkedAt);
    }
  });
});
