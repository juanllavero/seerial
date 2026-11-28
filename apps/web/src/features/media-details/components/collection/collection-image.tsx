import type { Collection } from '@seerial/domain';
import useScreenHeight from '@/shared/hooks/use-height';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { getCoverSize, getPosterImage } from '@/shared/lib/react-utils';
import Image from '@/shared/ui/image';

interface CollectionImageProps {
  collection: Collection;
  type: string;
}

/** Covers of the items, used when the collection has no poster of its own */
const getItemCovers = (collection: Collection, type: string): string[] => {
  const items =
    type === 'Music' ? collection.albums : type === 'Shows' ? collection.shows : collection.movies;

  return (items ?? [])
    .map((item) => item.coverSrc)
    .filter((cover): cover is string => !!cover)
    .slice(0, 4);
};

function CollectionImage({ collection, type }: CollectionImageProps) {
  const screenHeight = useScreenHeight();
  const isMobile = useIsMobile();
  const ownPoster =
    (type === 'Music' && collection.musicPosterSrc) || collection.coverSrc || undefined;
  const covers = getItemCovers(collection, type);

  if (!ownPoster && covers.length > 1) {
    return (
      <div
        className={`${isMobile ? `h-screen ${type === 'Music' ? 'max-h-[55dvw]' : 'max-h-[80dvw]'} w-screen max-w-[55dvw]` : getCoverSize(screenHeight, type !== 'Music', false)}`}
      >
        {getPosterImage(collection.id, covers, type)}
      </div>
    );
  }

  return (
    <div
      className={`${isMobile ? `h-screen ${type === 'Music' ? 'max-h-[55dvw]' : 'max-h-[80dvw]'} w-screen max-w-[55dvw]` : getCoverSize(screenHeight, type !== 'Music', false)}`}
    >
      <Image
        url={ownPoster ?? covers[0] ?? ''}
        aspectRatio={type === 'Music' ? 1 : 2 / 3}
        fallbackSrc={type === 'Music' ? '/img/songDefault.png' : '/img/fileNotFound.jpg'}
        alt={'Collection Image'}
      />
    </div>
  );
}

export default CollectionImage;
