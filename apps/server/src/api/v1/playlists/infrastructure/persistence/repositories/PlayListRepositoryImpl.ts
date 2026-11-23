import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from '@/api/v1/base-repository/BaseRepository';
import type { Song } from '@/api/v1/songs/domain/Song';
import { GenericRepositoryHelper } from '@/helpers/GenericRepositoryHelper';
import logger from '@/utils/logger';
import type { PlayListRepositoryPort } from '../../../application/ports/PlayListRepositoryPort';
import type { PlayList } from '../../../domain/PlayList';
import { PlayListItemModel } from '../models/PlayListItemModel';
import { PlayListModel } from '../models/PlayListModel';

const SONG_RELATIONS = ['items', 'items.song'];

/**
 * Exposes the songs of a playlist (loaded through its items) as a flat `songs` list.
 */
class PlayListHelper extends GenericRepositoryHelper<PlayListModel, PlayList> {
  protected override toDomain(model: PlayListModel): PlayList {
    const { items, library: _library, ...playList } = model;

    if (!items) return playList;

    return {
      ...playList,
      songs: items.map((item) => item.song as unknown as Song).filter(Boolean),
    };
  }
}

export class PlayListRepositoryImpl extends BaseRepository implements PlayListRepositoryPort {
  // Generic helper for common CRUD operations
  private helper: PlayListHelper;

  constructor() {
    super();

    // Initialize helper
    this.helper = new PlayListHelper(PlayListModel, {
      entityName: 'PlayList',
      generateShortId: true,
    });
  }

  async findAll(): Promise<PlayList[]> {
    return this.helper.findAll({
      relations: SONG_RELATIONS,
    });
  }

  async findById(id: string): Promise<PlayList | null> {
    const validatedId = this.validateId(id, 'PlayList ID');
    return this.helper.findById(validatedId, {
      relations: SONG_RELATIONS,
    });
  }

  async findByFolder(folder: string): Promise<PlayList | null> {
    this.validateData(folder, 'Folder');
    return this.helper.findByField('folder', folder);
  }

  async findByLibrary(libraryId: string): Promise<PlayList[]> {
    const validatedId = this.validateId(libraryId, 'Library ID');
    return this.helper.findManyByField('libraryId', validatedId);
  }

  async create(playList: PlayList): Promise<PlayList> {
    this.validateData(playList, 'PlayList data');

    // Check if playlist already exists by ID
    if (playList.id) {
      const existingPlayList = await this.findById(playList.id);
      if (existingPlayList) {
        logger.info(`PlayList with ID ${playList.id} already exists`);
        return existingPlayList;
      }
    }

    // Generate UUID if it doesn't exist
    const dataToCreate = {
      ...playList,
      id: playList.id || uuidv4().split('-')[0],
    };

    return this.helper.create(dataToCreate, true);
  }

  async update(id: string, data: Partial<PlayList>): Promise<PlayList> {
    const validatedId = this.validateId(id, 'PlayList ID');
    this.validateData(data, 'Update data');
    return this.helper.update(validatedId, data);
  }

  async delete(id: string): Promise<void> {
    const validatedId = this.validateId(id, 'PlayList ID');
    return this.helper.delete(validatedId);
  }

  async addSongToPlaylist(playlistId: string, songId: string): Promise<void> {
    const validated = this.validateIds({ playlistId, songId });

    // Check if relation already exists
    const existingRelation = await PlayListItemModel.findOne({
      where: {
        playlistId: validated.playlistId,
        songId: validated.songId,
      },
    });

    if (existingRelation) {
      logger.info(`Song ${songId} is already in playlist ${playlistId}`);
      return;
    }

    // Create new relation
    const newRelationData = {
      playlistId: validated.playlistId,
      songId: validated.songId,
    };

    await this.helper.createRelationship(PlayListItemModel, newRelationData, true);
  }

  async removeSongFromPlaylist(playlistId: string, songId: string): Promise<void> {
    const validated = this.validateIds({ playlistId, songId });

    const whereCondition = {
      playlistId: validated.playlistId,
      songId: validated.songId,
    };

    await this.helper.deleteRelationship(PlayListItemModel, whereCondition);
  }
}
