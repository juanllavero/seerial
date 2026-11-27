import { createWithEqualityFn } from 'zustand/traditional';

interface SeriesDetailsFocusState {
  lastFocusedEpisodeBySeason: Record<string, string>;
  setLastFocusedEpisodeForSeason: (seasonId: string, episodeId: string) => void;
  getLastFocusedEpisodeForSeason: (seasonId: string) => string | undefined;
  /**
   * What the user has chosen since arriving at a history entry. The season and episode that come
   * with a navigation are only a starting point: going back from the player must not restore them.
   */
  seasonByNavigation: Record<string, string>;
  setSeasonForNavigation: (navigationKey: string, seasonId: string) => void;
  appliedEpisodeNavigations: Record<string, boolean>;
  markEpisodeNavigationApplied: (navigationKey: string) => void;
  /**
   * Episode the player moved on to by itself (next episode). Going back to the series must show
   * it, even when it is in another season than the one the user left from.
   */
  playedEpisode: PlayedEpisode | null;
  setPlayedEpisode: (playedEpisode: PlayedEpisode) => void;
  /** Returns the played episode of the series, once. */
  consumePlayedEpisode: (seriesId: string) => PlayedEpisode | null;
}

export interface PlayedEpisode {
  seriesId: string;
  seasonId: string;
  episodeId: string;
}

export const useSeriesDetailsFocusStore = createWithEqualityFn<SeriesDetailsFocusState>(
  (set, get) => ({
    lastFocusedEpisodeBySeason: {},

    setLastFocusedEpisodeForSeason(seasonId: string, episodeId: string) {
      set((state) => ({
        lastFocusedEpisodeBySeason: {
          ...state.lastFocusedEpisodeBySeason,
          [seasonId]: episodeId,
        },
      }));
    },

    getLastFocusedEpisodeForSeason(seasonId: string) {
      return get().lastFocusedEpisodeBySeason[seasonId];
    },

    seasonByNavigation: {},

    setSeasonForNavigation(navigationKey: string, seasonId: string) {
      set((state) => ({
        seasonByNavigation: { ...state.seasonByNavigation, [navigationKey]: seasonId },
      }));
    },

    appliedEpisodeNavigations: {},

    markEpisodeNavigationApplied(navigationKey: string) {
      set((state) => ({
        appliedEpisodeNavigations: { ...state.appliedEpisodeNavigations, [navigationKey]: true },
      }));
    },

    playedEpisode: null,

    setPlayedEpisode(playedEpisode: PlayedEpisode) {
      set({ playedEpisode });
    },

    consumePlayedEpisode(seriesId: string) {
      const { playedEpisode } = get();
      if (playedEpisode?.seriesId !== seriesId) return null;
      set({ playedEpisode: null });
      return playedEpisode;
    },
  }),
);
