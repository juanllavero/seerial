import { API, useCreate } from '@seerial/api';
import type { Episode } from '@seerial/domain';
import { t } from 'i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { shallow } from 'zustand/shallow';
import { useDialogStore } from '@/features/management';
import FlexBox from '@/shared/ui/flex-box';
import EpisodeCard from '../cards/episode-card';
import EpisodeCardDetails from '../cards/episode-card-details';

interface EpisodesListProps {
  episodes: Episode[];
  distribution: number;
  seriesId: string;
  seasonId: string;
  mutate: (matcher: (key: string) => boolean) => Promise<unknown> | unknown;
}

function EpisodesList({ episodes, distribution, seriesId, seasonId, mutate }: EpisodesListProps) {
  const navigate = useNavigate();
  const { libraryId } = useParams();
  const { openDialog } = useDialogStore((state) => ({ openDialog: state.openDialog }), shallow);
  const { create } = useCreate<unknown>();

  const goToEpisodePage = (episode: Episode) => {
    // The episode route lives under its library: `/episode/:id` matches no route
    navigate(`/library/${libraryId}/episode/${episode.id}`);
  };

  const getEpisodeMenu = (episode: Episode) => {
    return {
      items: [
        {
          items: [
            {
              title: 'Editar',
              action: () => openDialog('episode', { id: episode.id }),
            },
            {
              title: 'Eliminar',
              action: () => openDialog('deleteEpisode', { id: episode.id }),
            },
            {
              title: t('markWatched'),
              action: async () => {
                await create(API.episodes.setWatchState(episode.id), { state: true });

                mutate((key: string) => key.startsWith(API.series.get(seriesId || '')));
                mutate((key: string) => key.startsWith(API.seasons.get(seasonId || '')));
              },
            },
            {
              title: t('markUnwatched'),
              action: async () => {
                await create(API.episodes.setWatchState(episode.id), { state: false });

                mutate((key: string) => key.startsWith(API.series.get(seriesId || '')));
                mutate((key: string) => key.startsWith(API.seasons.get(seasonId || '')));
              },
            },
          ],
        },
      ],
    };
  };

  return (
    <>
      {distribution === 0 ? (
        <FlexBox gap={1} wrap="wrap" justify="start" align="start" width="100%" height={'100%'}>
          {episodes
            .sort((a, b) => a.episodeNumber - b.episodeNumber)
            .map((episode) => (
              <EpisodeCard
                key={'Episode card' + episode.id}
                episode={episode}
                goToDetails={goToEpisodePage}
                getEpisodeMenu={getEpisodeMenu}
                editEpisode={() => openDialog('episode', { id: episode.id })}
              />
            ))}
        </FlexBox>
      ) : (
        <FlexBox direction="column" gap={0.5}>
          {episodes
            .sort((a, b) => a.episodeNumber - b.episodeNumber)
            .map((episode) => (
              <EpisodeCardDetails
                key={'Episode details' + episode.id}
                episode={episode}
                goToDetails={goToEpisodePage}
                getEpisodeMenu={getEpisodeMenu}
                editEpisode={() => openDialog('episode', { id: episode.id })}
              />
            ))}
        </FlexBox>
      )}
    </>
  );
}

export default EpisodesList;
