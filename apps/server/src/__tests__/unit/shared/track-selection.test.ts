import {
  type AudioTrack,
  findMatchingTrackIndex,
  findPreferredAudioIndex,
  findPreferredSubtitleIndex,
  getAudioTrack,
  getSubtitleTrack,
  isForeignAudio,
  normalizeLanguage,
  normalizeSubtitleMode,
  resolveDefaultTracks,
  type SubtitleTrack,
  type Video,
} from '@seerial/domain';

const audio = (languageTag: string, extra: Partial<AudioTrack> = {}): AudioTrack =>
  ({ id: 0, languageTag, language: '', codec: 'AC3', displayTitle: '', selected: false, ...extra }) as AudioTrack;

const sub = (languageTag: string, extra: Partial<SubtitleTrack> = {}): SubtitleTrack =>
  ({ id: 0, languageTag, language: '', codec: 'SUBRIP', displayTitle: '(SRT)', title: '', ...extra }) as SubtitleTrack;

describe('normalizeLanguage / normalizeSubtitleMode', () => {
  it('compares codes of two and three letters, regions and native names', () => {
    expect(normalizeLanguage('es-ES')).toBe('es');
    expect(normalizeLanguage('spa')).toBe('es');
    expect(normalizeLanguage('fre')).toBe('fr');
    expect(normalizeLanguage('fra')).toBe('fr');
    expect(normalizeLanguage('日本語')).toBe('ja');
    expect(normalizeLanguage('Español')).toBe('es');
    expect(normalizeLanguage('')).toBe('');
    expect(normalizeLanguage(undefined)).toBe('');
  });

  it('knows the keys of the modes and the labels old clients saved', () => {
    expect(normalizeSubtitleMode('alwaysSubs')).toBe('alwaysSubs');
    expect(normalizeSubtitleMode('Mostrar siempre')).toBe('alwaysSubs');
    expect(normalizeSubtitleMode('Con audio extranjero')).toBe('autoSubs');
    expect(normalizeSubtitleMode('manual')).toBe('manualSubs');
    expect(normalizeSubtitleMode('')).toBe('autoSubs');
  });
});

describe('audio selection', () => {
  const tracks = [audio('eng'), audio('jpn'), audio('spa')];

  it('picks the first track in the preferred language, whatever the code used', () => {
    expect(findPreferredAudioIndex(tracks, 'ja')).toBe(1);
    expect(findPreferredAudioIndex(tracks, 'spa')).toBe(2);
    expect(findPreferredAudioIndex(tracks, 'es-ES')).toBe(2);
  });

  it('falls back to the first track', () => {
    expect(findPreferredAudioIndex(tracks, 'fr')).toBe(0);
    expect(findPreferredAudioIndex(tracks, '')).toBe(0);
    expect(findPreferredAudioIndex([], 'es')).toBe(-1);
  });

  it('considers foreign only a known language other than the preferred one', () => {
    expect(isForeignAudio(audio('eng'), 'es')).toBe(true);
    expect(isForeignAudio(audio('spa'), 'es')).toBe(false);
    expect(isForeignAudio(audio('und'), 'es')).toBe(false);
    expect(isForeignAudio(audio('eng'), '')).toBe(false);
  });
});

describe('subtitle selection', () => {
  const subtitles = [
    sub('eng'),
    sub('spa', { title: 'Castellano' }),
    sub('spa', { forced: true, displayTitle: '(Forced)(SRT)' }),
    sub('spa', { title: 'Latino' }),
  ];
  const prefs = (subsMode: string) => ({ preferAudioLan: 'es', preferSubLan: 'es', subsMode });

  it('always: a track in the language whatever the audio is', () => {
    expect(findPreferredSubtitleIndex(subtitles, audio('spa'), prefs('alwaysSubs'))).toBe(1);
    expect(findPreferredSubtitleIndex(subtitles, audio('eng'), prefs('alwaysSubs'))).toBe(1);
  });

  it('always: without tracks in the language, the first full track, or else the first forced one', () => {
    const others = [sub('fre', { forced: true }), sub('eng'), sub('ger')];
    expect(findPreferredSubtitleIndex(others, audio('eng'), prefs('alwaysSubs'))).toBe(1);
    const onlyForcedOthers = [sub('fre', { forced: true }), sub('eng', { forced: true })];
    expect(findPreferredSubtitleIndex(onlyForcedOthers, audio('eng'), prefs('alwaysSubs'))).toBe(0);
    // Also with no preferred language at all
    expect(
      findPreferredSubtitleIndex(others, audio('eng'), { ...prefs('alwaysSubs'), preferSubLan: '' }),
    ).toBe(1);
  });

  it('always: uses a forced track only when there is no other in the language', () => {
    const onlyForced = [sub('eng'), sub('spa', { forced: true })];
    expect(findPreferredSubtitleIndex(onlyForced, audio('spa'), prefs('alwaysSubs'))).toBe(1);
  });

  it('foreign audio: full subtitles when the audio is not the preferred one', () => {
    expect(findPreferredSubtitleIndex(subtitles, audio('eng'), prefs('autoSubs'))).toBe(1);
  });

  it('foreign audio: forced subtitles when the audio is the preferred one', () => {
    expect(findPreferredSubtitleIndex(subtitles, audio('spa'), prefs('autoSubs'))).toBe(2);
  });

  it('foreign audio: without a full track in the language, the first full track of the file', () => {
    const others = [sub('fre', { forced: true }), sub('eng'), sub('spa', { forced: true })];
    expect(findPreferredSubtitleIndex(others, audio('eng'), prefs('autoSubs'))).toBe(1);
    expect(findPreferredSubtitleIndex([sub('eng')], audio('eng'), prefs('autoSubs'))).toBe(0);
  });

  it('foreign audio: forced subtitles in the language when there are no full tracks at all', () => {
    const onlyForced = [sub('eng', { forced: true }), sub('spa', { forced: true })];
    expect(findPreferredSubtitleIndex(onlyForced, audio('eng'), prefs('autoSubs'))).toBe(1);
  });

  it('foreign audio: the preferred audio only gets forced tracks in the language, otherwise off', () => {
    expect(findPreferredSubtitleIndex([sub('spa')], audio('spa'), prefs('autoSubs'))).toBe(-1);
    expect(findPreferredSubtitleIndex([sub('eng')], audio('spa'), prefs('autoSubs'))).toBe(-1);
  });

  it('never: always off', () => {
    expect(findPreferredSubtitleIndex(subtitles, audio('eng'), prefs('manualSubs'))).toBe(-1);
  });

  it('detects forced tracks from the title of files scanned before the flag existed', () => {
    const legacy = [sub('spa', { displayTitle: '(Forced)(SRT)' }), sub('spa', { title: 'Full' })];
    expect(findPreferredSubtitleIndex(legacy, audio('spa'), prefs('autoSubs'))).toBe(0);
    expect(findPreferredSubtitleIndex(legacy, audio('eng'), prefs('autoSubs'))).toBe(1);
  });

  it('prefers the variant of Spanish of the language of the application', () => {
    const variants = [sub('spa', { title: 'Latino' }), sub('spa', { title: 'Castellano' })];
    expect(findPreferredSubtitleIndex(variants, audio('eng'), prefs('autoSubs'), 'es-ES')).toBe(1);
    expect(findPreferredSubtitleIndex(variants, audio('eng'), prefs('autoSubs'), 'es-MX')).toBe(0);
  });
});

describe('resolveDefaultTracks', () => {
  const video = {
    audioTracks: [audio('eng'), audio('spa')],
    subtitleTracks: [sub('spa'), sub('spa', { forced: true })],
  };

  it('chooses the audio and then the subtitles for it', () => {
    const preferences = { preferAudioLan: 'es', preferSubLan: 'es', subsMode: 'autoSubs' };

    expect(resolveDefaultTracks(video, preferences)).toEqual({ audioIndex: 1, subtitleIndex: 1 });
    // The user picked the English audio: the full subtitles are needed
    expect(resolveDefaultTracks(video, preferences, { audioIndex: 0 })).toEqual({ audioIndex: 0, subtitleIndex: 0 });
  });
});

describe('getAudioTrack / getSubtitleTrack', () => {
  const base = {
    audioTracks: [audio('eng', { id: 1 }), audio('jpn', { id: 2 })],
    subtitleTracks: [sub('spa', { id: 3 }), sub('spa', { id: 4, forced: true })],
  } as unknown as Video;

  it('uses what is stored in the video before the preferences', () => {
    const stored = { ...base, selectedAudioTrack: 0, selectedSubtitleTrack: 0 } as Video;
    expect(getAudioTrack('ja', stored)?.id).toBe(1);
    expect(getSubtitleTrack('es', 'autoSubs', stored, undefined, 'ja')).toMatchObject({ id: 3 });
  });

  it('answers "Off" for the stored -1 and for no match', () => {
    expect(getSubtitleTrack('es', 'autoSubs', { ...base, selectedSubtitleTrack: -1 } as Video)).toBe('Off');
    expect(getSubtitleTrack('fr', 'autoSubs', base)).toBe('Off');
  });

  it('follows the audio the library prefers when nothing is stored', () => {
    expect(getAudioTrack('ja', base)?.id).toBe(2);
    // Japanese audio is the preferred one: only forced subtitles
    expect(getSubtitleTrack('es', 'autoSubs', base, undefined, 'ja')).toMatchObject({ id: 4 });
    // English audio is foreign: the full subtitles
    expect(getSubtitleTrack('es', 'autoSubs', { ...base, selectedAudioTrack: 0 } as Video, undefined, 'ja')).toMatchObject({
      id: 3,
    });
  });
});

describe('findMatchingTrackIndex', () => {
  const source = [
    sub('eng'),
    sub('spa', { title: 'Castellano' }),
    sub('spa', { title: 'Latino' }),
    sub('spa', { forced: true }),
  ];

  it('finds the same track in another episode', () => {
    const target = [sub('spa', { title: 'Castellano' }), sub('spa', { title: 'Latino' }), sub('eng')];
    expect(findMatchingTrackIndex(source, 2, target)).toBe(1);
    expect(findMatchingTrackIndex(source, 0, target)).toBe(2);
  });

  it('uses the position among the tracks of the language when the titles differ', () => {
    const target = [sub('eng'), sub('spa', { title: 'ES 1' }), sub('spa', { title: 'ES 2' })];
    expect(findMatchingTrackIndex(source, 1, target)).toBe(1);
    expect(findMatchingTrackIndex(source, 2, target)).toBe(2);
  });

  it('keeps forced and full tracks apart', () => {
    const target = [sub('spa', { forced: true }), sub('spa', { title: 'Castellano' })];
    expect(findMatchingTrackIndex(source, 3, target)).toBe(0);
    expect(findMatchingTrackIndex(source, 1, target)).toBe(1);
  });

  it('finds nothing when the other video has no such track', () => {
    expect(findMatchingTrackIndex(source, 2, [sub('spa', { title: 'Castellano' })])).toBe(-1);
    expect(findMatchingTrackIndex(source, 1, [sub('eng')])).toBe(-1);
    expect(findMatchingTrackIndex(source, 9, source)).toBe(-1);
  });
});
