import type { MediaFormatBadge } from '@seerial/domain';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface MediaFormatLogosProps {
  badges: MediaFormatBadge[];
  className?: string;
}

interface LogoSpec {
  src: string;
  alt: string;
  /** Aspect ratio (width / height) of the whole image, margins included. */
  imageRatio: number;
  /** Where the artwork sits inside the image, as fractions of its width and height. */
  ink: { x: number; y: number; w: number; h: number };
  /** Height of the visible artwork, in dvh: tuned so that all the logos weigh the same. */
  height: number;
  /**
   * Single-color artwork: it is painted white to read on the dark UI. Logos with their own colors
   * (DTS-HD MA, HDR10+) keep them and sit on a light plate instead, because part of their artwork
   * is black.
   */
  flat: boolean;
  /** Draws the light plate behind a full-color logo that has black artwork. */
  plate?: boolean;
}

// The SVGs come with very different margins (24x24 icons with the glyphs in the middle, wordmarks
// cropped to the edge...). The visible artwork box of each one was measured, so every logo is
// cropped to it and sized by the height of what can actually be seen.
const LOGOS: Record<MediaFormatBadge, LogoSpec> = {
  hd: {
    src: '/img/logos/video/hd.svg',
    alt: 'HD',
    imageRatio: 1,
    ink: { x: 0, y: 0.125, w: 1, h: 0.75 },
    height: 2.8,
    flat: true,
  },
  '4k': {
    src: '/img/logos/video/4k.svg',
    alt: '4K',
    imageRatio: 1,
    ink: { x: 0, y: 0.125, w: 1, h: 0.75 },
    height: 2.8,
    flat: true,
  },
  'dolby-vision': {
    src: '/img/logos/video/dolby-vision.svg',
    alt: 'Dolby Vision',
    imageRatio: 6.8183,
    ink: { x: 0, y: 0, w: 1, h: 1 },
    height: 2.2,
    flat: true,
  },
  'dolby-vision-atmos': {
    src: '/img/logos/video/dolby-vision-atmos.png',
    alt: 'Dolby Vision + Dolby Atmos',
    imageRatio: 2.3256,
    ink: { x: 0.0187, y: 0.0822, w: 0.9647, h: 0.8357 },
    height: 3.6,
    flat: true,
  },
  hdr: {
    src: '/img/logos/video/hdr.svg',
    alt: 'HDR',
    imageRatio: 1,
    ink: { x: 0.025, y: 0.375, w: 0.75, h: 0.25 },
    height: 2.2,
    flat: true,
  },
  hdr10plus: {
    src: '/img/logos/video/hdr10plus.svg',
    alt: 'HDR10+',
    imageRatio: 4.5455,
    ink: { x: 0.0103, y: 0.035, w: 0.9897, h: 0.965 },
    height: 2.0,
    flat: false,
    plate: true,
  },
  'dolby-atmos': {
    src: '/img/logos/audio/dolby-atmos.svg',
    alt: 'Dolby Atmos',
    imageRatio: 1,
    ink: { x: 0.0833, y: 0.3367, w: 0.8333, h: 0.3283 },
    height: 2.8,
    flat: true,
  },
  dtsx: {
    src: '/img/logos/audio/dtsx.svg',
    alt: 'DTS:X',
    imageRatio: 1,
    ink: { x: 0.0833, y: 0.3783, w: 0.8333, h: 0.2433 },
    height: 2.4,
    flat: true,
  },
  'dts-hd': {
    src: '/img/logos/audio/dts-hd.svg',
    alt: 'DTS-HD Master Audio',
    imageRatio: 2.8947,
    ink: { x: 0.0288, y: 0.0867, w: 0.9407, h: 0.8133 },
    height: 2.2,
    flat: false,
    plate: true,
  },
  dts: {
    src: '/img/logos/audio/dts.svg',
    alt: 'DTS',
    imageRatio: 1,
    ink: { x: 0, y: 0.2967, w: 1, h: 0.4067 },
    height: 2.2,
    flat: true,
  },
  'dolby-digital': {
    src: '/img/logos/audio/dolby-digital.svg',
    alt: 'Dolby Digital',
    imageRatio: 3.958,
    ink: { x: 0.0046, y: 0.0183, w: 0.9903, h: 0.9633 },
    height: 2.2,
    flat: true,
  },
  'dolby-digital-plus': {
    src: '/img/logos/audio/dolby-digital-plus.svg',
    alt: 'Dolby Digital Plus',
    imageRatio: 4.2442,
    ink: { x: 0.0008, y: 0, w: 0.9788, h: 1 },
    height: 2.2,
    flat: true,
  },
};

const IMDB_LOGO: LogoSpec = {
  src: '/img/logos/imdb.svg',
  alt: 'IMDb Logo',
  imageRatio: 1.5,
  ink: { x: 0.1, y: 0.2733, w: 0.6429, h: 0.4333 },
  height: 2.4,
  flat: false,
};

// Dark artwork on a transparent background (or monochrome `currentColor` icons, which an <img>
// renders black): every color is replaced by white and the transparency is kept.
const WHITE_LOGO_FILTER = 'brightness(0) invert(1)';

export function ImdbLogo() {
  return <FormatLogo spec={IMDB_LOGO} />;
}

function FormatLogo({ spec }: { spec: LogoSpec }) {
  const { ink, imageRatio, height } = spec;
  // Size of the whole image so that the visible artwork measures `height`
  const imageHeight = height / ink.h;
  const imageWidth = imageHeight * imageRatio;
  const artworkWidth = imageWidth * ink.w;

  const artwork = (
    <span
      className="relative block overflow-hidden shrink-0"
      style={{ width: `${artworkWidth}dvh`, height: `${height}dvh` }}
    >
      <img
        src={spec.src}
        alt={spec.alt}
        draggable={false}
        className="absolute max-w-none"
        style={{
          width: `${imageWidth}dvh`,
          height: `${imageHeight}dvh`,
          left: `${-ink.x * imageWidth}dvh`,
          top: `${-ink.y * imageHeight}dvh`,
          filter: spec.flat ? WHITE_LOGO_FILTER : undefined,
        }}
      />
    </span>
  );

  if (!spec.plate) return artwork;

  return (
    <span
      className="flex items-center"
      style={{
        padding: '0.5dvh 0.8dvh',
        borderRadius: '0.6dvh',
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
      }}
    >
      {artwork}
    </span>
  );
}

/**
 * Format logos of a movie shown next to its info: resolution (HD, 4K), picture (Dolby Vision, HDR10+,
 * HDR) and audio (Dolby Atmos, DTS:X, DTS-HD MA, DTS, Dolby Digital Plus, Dolby Digital).
 * Which ones appear depends on the selected tracks, see `getMediaFormatBadges`.
 */
function MediaFormatLogos({ badges, className = '' }: MediaFormatLogosProps) {
  const { t } = useTranslation();

  if (badges.length === 0) {
    return null;
  }

  return (
    <ul
      className={`flex flex-row items-center gap-[1.6dvh] list-none p-0 m-0 ${className}`}
      aria-label={t('mediaFormats')}
      data-testid="media-format-logos"
    >
      {badges.map((badge) => (
        <li key={badge} data-badge={badge} className="flex items-center">
          <FormatLogo spec={LOGOS[badge]} />
        </li>
      ))}
    </ul>
  );
}

export default memo(MediaFormatLogos);
