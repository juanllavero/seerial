import { parseGenericSeasonName, type Season } from '@seerial/domain';
import type { TFunction } from 'i18next';

/**
 * Name of a season in the language of the application. Generic names ("Season 2", "Specials") come
 * in English when TMDB has no translation, so they are rebuilt; real names (an arc, a subtitle) are
 * kept as they are.
 */
export function getSeasonDisplayName(
  season: Pick<Season, 'name' | 'seasonNumber'>,
  t: TFunction,
): string {
  const generic = parseGenericSeasonName(season.name, season.seasonNumber);
  if (!generic) return season.name.trim();
  return generic.kind === 'specials' ? t('specials') : `${t('season')} ${generic.number}`;
}
