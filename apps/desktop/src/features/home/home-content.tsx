import { type ContinueWatchingVideoDTO, formatDate, formatTimeForView } from '@seerial/domain';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import HomeHeroImage from '@/features/home/components/home-hero-image';
import GradientBackground from '@/shared/components/backgrounds/gradient-background';
import DetailsInfo from '@/shared/components/details/details-info';
import ContinueWatchingContent from './components/continue-watching-content';

function getSelectedInfoItems(selectedElement: ContinueWatchingVideoDTO | null, t: TFunction) {
  if (!selectedElement) {
    return [];
  }

  const episodeCode = selectedElement.episodeNumber
    ? `${t('seasonLetter')}${selectedElement.seasonNumber}${t('episodeLetter')}${selectedElement.episodeNumber}`
    : undefined;
  const releaseDate = selectedElement.episodeId
    ? formatDate(selectedElement.date ?? '')
    : selectedElement.date.split('-')[0];

  // Total length, as on the details page (minutes); the remaining time is the progress circle
  const duration = selectedElement.duration > 0 ? formatTimeForView(selectedElement.duration) : '';

  return [episodeCode, releaseDate, duration].filter(Boolean) as string[];
}

interface HomePageContentProps {
  continueWatching: ContinueWatchingVideoDTO[];
  selectedElement: ContinueWatchingVideoDTO | null;
  setSelectedElement: React.Dispatch<React.SetStateAction<ContinueWatchingVideoDTO | null>>;
}

function HomePageContent({
  continueWatching,
  selectedElement,
  setSelectedElement,
}: HomePageContentProps) {
  const imageSrc = selectedElement?.backgroundImage ?? selectedElement?.posterImage;
  const { t } = useTranslation();
  const infoItems = getSelectedInfoItems(selectedElement, t);

  return (
    <>
      <GradientBackground imageSrc={imageSrc} index={0} />
      <HomeHeroImage imageSrc={imageSrc} />

      <DetailsInfo
        details={{
          title: selectedElement?.title ?? '',
          subtitle: selectedElement?.subtitle ?? '',
          genres: selectedElement?.genres.join(', ') ?? '',
          description: selectedElement?.overview ?? '',
        }}
        durationInfo={selectedElement?.duration}
        timeWatchedInfo={selectedElement?.timeWatched}
        infoItems={infoItems}
        behaviorOptions={{
          enableKeyboardBack: false,
        }}
        displayOptions={{
          hideButtons: true,
        }}
      />

      {/* <LogoIntro /> */}

      <ContinueWatchingContent
        continueWatching={continueWatching}
        selectedElement={selectedElement}
        setSelectedElement={setSelectedElement}
      />
    </>
  );
}

export default HomePageContent;
