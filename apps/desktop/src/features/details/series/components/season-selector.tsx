import type { Season } from '@seerial/domain';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { NavigationButton, NavigationScrollView } from '@/shared/components/navigation';
import FlexBox from '@/shared/components/ui/flex-box';
import { getSeasonDisplayName } from '@/shared/utils/season-name';

interface SeasonSelectorProps {
  seasons: Season[];
  selectedSeasonId?: string;
  onSelectSeason: (season: Season) => void;
}

function SeasonSelector({ seasons, selectedSeasonId, onSelectSeason }: SeasonSelectorProps) {
  const { t } = useTranslation();
  // The initial season is chosen by the parent: selecting one here would overwrite the season
  // requested by the navigation (continue watching, back from the player) before it is applied
  const sortedSeasons = useMemo(
    () => seasons.toSorted((a, b) => a.seasonNumber - b.seasonNumber),
    [seasons],
  );

  return (
    <FlexBox gap={1} width={'100%'} height={'7dvh'} padding="1dvh" className="z-10">
      {seasons.length > 1 && (
        <NavigationScrollView
          className="gap-5 z-10 w-[70dvw]"
          direction="horizontal"
          scrollMode="center"
          focusedElementId={selectedSeasonId}
          isRestoringFocus={false}
        >
          {sortedSeasons.map((season) => (
            <NavigationButton
              variant="ghost"
              key={season.id}
              customKey={season.id}
              text={getSeasonDisplayName(season, t)}
              selected={selectedSeasonId === season.id}
              className={`${selectedSeasonId === season.id ? 'color-app-color' : ''}`}
              onClick={() => onSelectSeason(season)}
            />
          ))}
        </NavigationScrollView>
      )}
    </FlexBox>
  );
}

export default memo(SeasonSelector);
