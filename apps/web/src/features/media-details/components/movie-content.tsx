import type { Movie } from '@seerial/domain';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import HorizontalList from '@/shared/lists/horizontal-list';
import FlexBox from '@/shared/ui/flex-box';
import VideoCard from './cards/video-card';

interface MovieContentProps {
  movie: Movie;
}

function MovieContent({ movie }: MovieContentProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const getEpisodeMenu = () => {
    return {
      items: [
        {
          items: [
            {
              title: 'Editar',
              action: () => {},
            },
            {
              title: 'Eliminar',
              action: () => {},
            },
          ],
        },
      ],
    };
  };

  return (
    <FlexBox
      direction="column"
      gap={2}
      margin="1rem 0 0 0"
      padding={isMobile ? '1rem 2rem' : '0'}
      width={'100%'}
    >
      {movie.videos && movie.videos.length > 1 && (
        <HorizontalList title={t('videos')}>
          {movie.videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              getVideoMenu={getEpisodeMenu}
              title={video.title}
              subtitle={''}
            />
          ))}
        </HorizontalList>
      )}

      {movie.extras && movie.extras.length > 0 && (
        <HorizontalList title={t('extras')}>
          {movie.extras.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              getVideoMenu={getEpisodeMenu}
              title={video.title}
              subtitle={video.extraType ? t(video.extraType) : ''}
            />
          ))}
        </HorizontalList>
      )}
    </FlexBox>
  );
}

export default MovieContent;
