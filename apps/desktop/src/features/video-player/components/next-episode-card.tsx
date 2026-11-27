import type { Episode } from '@seerial/domain';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import Image from '@/shared/components/ui/image';

interface NextEpisodeCardProps {
  episode: Episode;
  visible: boolean;
  fallbackImageSrc?: string;
  onPlay: () => void;
}

/** Small card in the bottom right corner that starts the next episode. */
function NextEpisodeCard({ episode, visible, fallbackImageSrc, onPlay }: NextEpisodeCardProps) {
  const { t } = useTranslation();
  const label = `${t('seasonLetter')}${episode.seasonNumber}${t('episodeLetter')}${episode.episodeNumber}`;

  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onPlay}
      aria-hidden={!visible}
      className="group fixed right-[4dvh] bottom-[6dvh] z-80 flex w-[44dvh] items-center gap-[1.6dvh] rounded-xl border border-white/10 bg-black/60 p-[1.2dvh] text-left backdrop-blur-md transition-all duration-500 ease-out hover:border-white/40 hover:bg-black/75"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(1.5dvh)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div className="relative aspect-video w-[18dvh] shrink-0 overflow-hidden rounded-lg bg-black/40">
        <Image
          url={episode.video.imgSrc || fallbackImageSrc}
          fallbackSrc="/img/Default_video_thumbnail.jpg"
          alt={episode.name}
          aspectRatio="16/9"
          width="100%"
          height="100%"
          tmdbSize="w500"
          showSkeleton={false}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-90 transition-opacity group-hover:opacity-100">
          <svg viewBox="0 0 24 24" className="h-[3.4dvh] w-[3.4dvh] fill-white" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-[0.4dvh]">
        <span className="text-[1.4dvh] font-semibold uppercase tracking-wide text-white/60">
          {t('nextEpisode')}
        </span>
        <span className="truncate text-[1.9dvh] font-bold text-white">{episode.name}</span>
        <span className="text-[1.5dvh] font-medium text-white/70">{label}</span>
        <span className="text-[1.3dvh] text-white/45">{t('nextEpisodeHint')}</span>
      </div>
    </button>
  );
}

export default memo(NextEpisodeCard);
