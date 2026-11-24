import type { CastData, DetailsData, MediaFormatBadge } from '@seerial/domain';

interface DetailsInfoDisplayOptions {
  isWatched?: boolean;
  hideUnwatchedThumbnails?: boolean;
  hideButtons?: boolean;
}

interface DetailsInfoBehaviorOptions {
  enableKeyboardBack?: boolean;
  disableInitialFocus?: boolean;
}

export interface DetailsInfoProps {
  details: DetailsData | undefined;
  customDescription?: string;
  subtitle?: string;
  infoItems?: string[];
  durationInfo?: number;
  timeWatchedInfo?: number;
  handlePlay?: () => void;
  handleMoreOptions?: () => void;
  handleMarkWatched?: () => void;
  handleToggleHideThumbnails?: () => void;
  videoInfo?: string;
  /** Format logos (HDR, DTS-HD, Dolby Atmos) shown in the info row under the title. */
  mediaFormatBadges?: MediaFormatBadge[];
  audioInfo?: string;
  subtitleInfo?: string;
  displayOptions?: DetailsInfoDisplayOptions;
  behaviorOptions?: DetailsInfoBehaviorOptions;
  cast?: CastData[];
  isExpandedImageLandscape?: boolean;
  expandedImageSrc?: string;
  expandedTitle?: string;
  onDescriptionExpandedChange?: (expanded: boolean) => void;
}
