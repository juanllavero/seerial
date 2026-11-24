import { useGetMovie, useSetMovieWatchState } from '@seerial/api';
import type { Movie } from '@seerial/domain';
import { useServerStore } from '@seerial/stores';
import { t } from 'i18next';
import { Button } from '@/shared/ui/button';
import { AddToListIcon, RemoveFromListIcon } from '@/shared/ui/icon-library';

interface MyListButtonProps {
  movieId: string;
}

function MyListButton({ movieId }: MyListButtonProps) {
  const user = useServerStore((state) => state.currentUser);
  const { data: movie, refetch } = useGetMovie<Movie>(movieId, {
    enabled: Boolean(movieId),
  });
  const { mutateAsync: setMovieWatchState } = useSetMovieWatchState<
    unknown,
    { watched: boolean }
  >(movieId);

  const inMyList =
    movie?.watchLists?.some((list) => list.userId === user?.id && list.watched) ?? false;

  const toggleMyList = async () => {
    await setMovieWatchState({ watched: !inMyList });
    void refetch();
  };
  return (
    <Button
      variant={'ghost'}
      title={inMyList ? t('removeFromMyList') : t('addToMyList')}
      onClick={toggleMyList}
    >
      {inMyList ? <RemoveFromListIcon /> : <AddToListIcon />}
    </Button>
  );
}

export default MyListButton;
