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
  }),
);
