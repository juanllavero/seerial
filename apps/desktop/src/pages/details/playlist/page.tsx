import { useGetPlaylist } from '@seerial/api';
import type { Album, DetailsData, PlayList } from '@seerial/domain';
import { memo, useMemo } from 'react';
import { useParams } from 'react-router';
import { AlbumDetails } from '@/features/details';

/**
 * A playlist is shown with the album details layout: its songs come from different albums,
 * so the playlist itself plays the role of the "album" the music player displays.
 */
function toAlbum(playlist: PlayList): Album {
  return {
    id: playlist.id,
    libraryId: playlist.libraryId ?? '',
    title: playlist.title,
    coverSrc: playlist.images?.[0] ?? '',
    folder: playlist.folder ?? '',
    description: playlist.description ?? '',
    songs: playlist.songs ?? [],
  } as unknown as Album;
}

function PlaylistDetailsPage() {
  const { playlistId } = useParams();

  const { data: playlist, isLoading } = useGetPlaylist<PlayList>(playlistId ?? '', {
    enabled: !!playlistId,
  });

  const album = useMemo(() => (playlist ? toAlbum(playlist) : undefined), [playlist]);
  const details = useMemo<DetailsData | undefined>(() => {
    if (!playlist) return undefined;
    const count = playlist.songs?.length ?? 0;

    return {
      title: playlist.title,
      subtitle: `${count} ${count === 1 ? 'canción' : 'canciones'}`,
      genres: '',
      description: playlist.description ?? '',
      coverSrc: playlist.images?.[0] ?? '',
    };
  }, [playlist]);

  return <AlbumDetails album={album} isLoading={isLoading} details={details} keepSongOrder />;
}

export default memo(PlaylistDetailsPage);
