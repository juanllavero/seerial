import type { Episode, TvSeasonResponse } from 'moviedb-promise';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A prologue ("episode 0") airs at most this long before its season, or a few days after it. */
const PROLOGUE_DAYS_BEFORE = 90;
const PROLOGUE_DAYS_AFTER = 7;
/** Extra episodes at the end of a season air at most this long after its last episode. */
const EXTRA_DAYS_AFTER = 2 * 365;

/** Differences allowed between the duration of the file and the runtime of TMDb. */
const RUNTIME_TOLERANCE_MINUTES = 3;
const RUNTIME_TOLERANCE_RATIO = 0.05;

/**
 * Finds the TMDb special that corresponds to a file numbered outside of its season: an "episode 0"
 * (Mushoku Tensei S02E00) or episodes after the last one (Attack on Titan S04E29 and S04E30), which
 * TMDb keeps in season 0.
 *
 * A special is only returned when it is a clear match: aired next to that season and with the
 * duration of the file. Giving no metadata is better than giving the ones of another episode.
 */
export function matchSpecialEpisode(
  seasonsMetadata: TvSeasonResponse[],
  seasonNumber: number,
  episodeNumber: number,
  fileMinutes: number,
): Episode | null {
  if (seasonNumber < 1 || fileMinutes <= 0) return null;

  const season = seasonsMetadata.find((s) => s.season_number === seasonNumber);
  const numbers = (season?.episodes ?? []).map((e) => e.episode_number ?? 0);
  const airDates = airDatesOf(season);
  if (numbers.length === 0 || airDates.length === 0) return null;

  const isPrologue = episodeNumber < Math.min(...numbers);
  const isExtra = episodeNumber > Math.max(...numbers);
  if (!isPrologue && !isExtra) return null;

  const premiere = Math.min(...airDates);
  const finale = Math.max(...airDates);

  // The special cannot belong to the previous or to the next season
  const previousFinale = Math.max(
    ...seasonsMetadata
      .filter((s) => (s.season_number ?? 0) >= 1 && (s.season_number ?? 0) < seasonNumber)
      .flatMap(airDatesOf),
  );
  const nextPremiere = Math.min(
    ...seasonsMetadata.filter((s) => (s.season_number ?? 0) > seasonNumber).flatMap(airDatesOf),
  );

  const from = isPrologue
    ? Math.max(premiere - PROLOGUE_DAYS_BEFORE * DAY_MS, previousFinale + DAY_MS)
    : finale;
  const to = isPrologue
    ? premiere + PROLOGUE_DAYS_AFTER * DAY_MS
    : Math.min(finale + EXTRA_DAYS_AFTER * DAY_MS, nextPremiere - DAY_MS);

  const tolerance = Math.max(RUNTIME_TOLERANCE_MINUTES, fileMinutes * RUNTIME_TOLERANCE_RATIO);
  const specials = seasonsMetadata.find((s) => s.season_number === 0)?.episodes ?? [];
  const candidates = specials.filter((special) => {
    const airDate = Date.parse(special.air_date ?? '');
    const runtime = special.runtime ?? 0;
    return (
      airDate >= from &&
      airDate <= to &&
      runtime > 0 &&
      Math.abs(runtime - fileMinutes) <= tolerance
    );
  });

  if (!isPrologue) return candidates.length === 1 ? candidates[0] : null;

  // Several possible prologues: the closest one to the premiere, if only one is that close
  const distance = (special: Episode) => Math.abs(Date.parse(special.air_date ?? '') - premiere);
  const [closest, second] = [...candidates].sort((a, b) => distance(a) - distance(b));
  if (!closest || (second && distance(second) === distance(closest))) return null;

  return closest;
}

function airDatesOf(season: TvSeasonResponse | undefined): number[] {
  return (season?.episodes ?? [])
    .map((e) => Date.parse(e.air_date ?? ''))
    .filter((date) => !Number.isNaN(date));
}
