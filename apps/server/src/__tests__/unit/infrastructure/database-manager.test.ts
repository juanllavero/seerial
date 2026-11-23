jest.mock('@/api/v1/shared/infrastructure/adapters/di/container', () => ({
  fileSystemService: {
    getExternalPath: jest.fn((p: string) => `C:/tmp/${p}`),
    existsSync: jest.fn(() => true),
    createFolder: jest.fn(),
  },
}));

const { fileSystemService } = jest.requireMock(
  '@/api/v1/shared/infrastructure/adapters/di/container',
);

const initialize = jest.fn();
const connect = jest.fn();
const query = jest.fn();
const synchronize = jest.fn();
const runMigrations = jest.fn();
const undoLastMigration = jest.fn();
const dropDatabase = jest.fn();
const destroy = jest.fn();
const getRepository = jest.fn();
const createQueryRunner = jest.fn();

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    DataSource: jest.fn().mockImplementation(() => ({
      isInitialized: true,
      initialize,
      query,
      synchronize,
      runMigrations,
      undoLastMigration,
      dropDatabase,
      destroy,
      getRepository,
      createQueryRunner,
      manager: { id: 'manager' },
    })),
  };
});

import { DatabaseManager } from '@/api/v1/shared/infrastructure/persistence/DatabaseManager';

describe('DatabaseManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileSystemService.existsSync.mockReturnValue(true);
    DatabaseManager.dataSource = null;
  });

  it('returns DB_PATH through fileSystemService', () => {
    expect(DatabaseManager.DB_PATH).toContain('resources/db/data.db');
  });

  it('throws when getDataSource is called before initialization', () => {
    expect(() => DatabaseManager.getDataSource()).toThrow('DataSource has not been initialized');
  });

  it('throws when data source exists but is not initialized', () => {
    DatabaseManager.dataSource = {
      isInitialized: false,
    } as never;

    expect(() => DatabaseManager.getDataSource()).toThrow('DataSource is not initialized');
  });

  it('initializes database and runs pragmas', async () => {
    const release = jest.fn();
    createQueryRunner.mockReturnValue({ connect, query, release });

    await DatabaseManager.initializeDB();

    expect(initialize).toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;');
    expect(synchronize).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it('creates db directory when missing', async () => {
    const release = jest.fn();
    createQueryRunner.mockReturnValue({ connect, query, release });
    fileSystemService.existsSync.mockReturnValue(false);

    await DatabaseManager.initializeDB();

    expect(fileSystemService.createFolder).toHaveBeenCalled();
  });

  it('runs health checks and helper wrappers', async () => {
    const release = jest.fn();
    createQueryRunner.mockReturnValue({ connect, query, release });
    await DatabaseManager.initializeDB();

    query.mockResolvedValueOnce([{ ok: 1 }]);
    await expect(DatabaseManager.query('SELECT 1')).resolves.toEqual([{ ok: 1 }]);

    query.mockResolvedValueOnce([{ ok: 1 }]);
    await expect(DatabaseManager.healthCheck()).resolves.toBe(true);
    expect(DatabaseManager.isInitialized()).toBe(true);
    expect(DatabaseManager.getEntityManager()).toEqual({ id: 'manager' });

    DatabaseManager.getRepository(Object);
    expect(getRepository).toHaveBeenCalled();

    DatabaseManager.createQueryRunner();
    expect(createQueryRunner).toHaveBeenCalled();

    await DatabaseManager.runMigrations();
    await DatabaseManager.revertLastMigration();
    await DatabaseManager.synchronize(true);
    expect(dropDatabase).toHaveBeenCalled();

    await DatabaseManager.close();
    expect(destroy).toHaveBeenCalled();
  });

  it('wraps initialization errors with a friendly message', async () => {
    initialize.mockRejectedValueOnce(new Error('init failed'));

    await expect(DatabaseManager.initializeDB()).rejects.toThrow(
      'Database initialization failed: init failed',
    );
  });

  it('returns false on health check when dataSource reports not initialized', async () => {
    const ds = {
      isInitialized: false,
      query: jest.fn(),
    } as never;
    const spy = jest.spyOn(DatabaseManager, 'getDataSource').mockReturnValue(ds);

    await expect(DatabaseManager.healthCheck()).resolves.toBe(false);

    spy.mockRestore();
  });

  it('propagates query and migration wrapper errors', async () => {
    const release = jest.fn();
    createQueryRunner.mockReturnValue({ connect, query, release });
    await DatabaseManager.initializeDB();

    query.mockRejectedValueOnce(new Error('query failed'));
    await expect(DatabaseManager.query('SELECT * FROM x')).rejects.toThrow('query failed');

    runMigrations.mockRejectedValueOnce(new Error('migration failed'));
    await expect(DatabaseManager.runMigrations()).rejects.toThrow('migration failed');

    undoLastMigration.mockRejectedValueOnce(new Error('undo failed'));
    await expect(DatabaseManager.revertLastMigration()).rejects.toThrow('undo failed');

    synchronize.mockRejectedValueOnce(new Error('sync failed'));
    await expect(DatabaseManager.synchronize()).rejects.toThrow('sync failed');
  });
});
