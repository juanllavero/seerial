import type { AudioTrack, SubtitleTrack } from '@seerial/domain';
import { isLatinSpanishTrack } from '@seerial/domain';

/** Name of the language of a track, in the language of the interface. */
export function getLanguageName(
  track: { languageTag: string; language: string },
  title: string | undefined,
  uiLanguage: string,
): string {
  if (track.languageTag === 'spa') {
    // Only the title of a track tells the variants of Spanish apart
    if (!title) return 'Español';
    return isLatinSpanishTrack({ languageTag: track.languageTag, title })
      ? 'Español (Latinoamérica)'
      : 'Español (España)';
  }

  try {
    const name =
      track.languageTag && track.languageTag !== 'und'
        ? new Intl.DisplayNames([uiLanguage], { type: 'language' }).of(track.languageTag)
        : undefined;
    if (name) return name.charAt(0).toLocaleUpperCase(uiLanguage) + name.slice(1);
  } catch {
    // Not a valid language tag: fall back to whatever the server read
  }
  return track.language || track.languageTag;
}

/** Codec and channels of an audio track, e.g. "AAC STEREO". */
export function getAudioFormat(track: AudioTrack): string {
  return track.displayTitle.replace(/^\(|\)$/g, '');
}

export function getSubtitleFormat(track: SubtitleTrack): string {
  if (track.codec === 'SUBRIP') return 'SRT';
  if (track.codec === 'HDMV_PGS_SUBTITLE') return 'PGS';
  return track.codec;
}

export function isForcedTrack(track: SubtitleTrack): boolean {
  return !!track.forced || track.displayTitle.includes('(Forced)');
}

/** One line description of an audio track: language and format. */
export function formatAudioSummary(track: AudioTrack, uiLanguage: string): string {
  return [getLanguageName(track, undefined, uiLanguage), getAudioFormat(track)]
    .filter(Boolean)
    .join(' · ');
}

/** One line description of a subtitle track: language, whether it is forced and format. */
export function formatSubtitleSummary(
  track: SubtitleTrack,
  uiLanguage: string,
  forcedLabel: string,
): string {
  return [
    getLanguageName(track, track.title, uiLanguage),
    isForcedTrack(track) ? forcedLabel : '',
    getSubtitleFormat(track),
  ]
    .filter(Boolean)
    .join(' · ');
}
