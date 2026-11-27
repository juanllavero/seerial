import { localizeSeasonName, parseGenericSeasonName } from '@seerial/domain';

describe('parseGenericSeasonName', () => {
  it('recognises the generic names of TMDB and of the scanner, in several languages', () => {
    expect(parseGenericSeasonName('Season 2')).toEqual({ kind: 'season', number: 2 });
    expect(parseGenericSeasonName('Temporada 02')).toEqual({ kind: 'season', number: 2 });
    expect(parseGenericSeasonName('Saison 3')).toEqual({ kind: 'season', number: 3 });
    expect(parseGenericSeasonName('Specials')).toEqual({ kind: 'specials' });
    expect(parseGenericSeasonName('Especiales')).toEqual({ kind: 'specials' });
  });

  it('keeps real names', () => {
    expect(parseGenericSeasonName('Arc of the Kazekage Rescue')).toBeNull();
    expect(parseGenericSeasonName('Season 2: The Return')).toBeNull();
  });

  it('names a season without name from its number', () => {
    expect(parseGenericSeasonName('', 3)).toEqual({ kind: 'season', number: 3 });
    expect(parseGenericSeasonName('', 0)).toEqual({ kind: 'specials' });
  });
});

describe('localizeSeasonName', () => {
  it('rewrites generic names in the language of the library', () => {
    expect(localizeSeasonName('Season 2', 2, 'es-ES')).toBe('Temporada 2');
    expect(localizeSeasonName('Specials', 0, 'es')).toBe('Especiales');
    expect(localizeSeasonName('Temporada 4', 4, 'en-US')).toBe('Season 4');
    expect(localizeSeasonName('', 5, 'fr-FR')).toBe('Saison 5');
  });

  it('keeps real names and uses English for languages without words of their own', () => {
    expect(localizeSeasonName('Kazekage', 1, 'es-ES')).toBe('Kazekage');
    expect(localizeSeasonName('Season 2', 2, 'ja-JP')).toBe('Season 2');
  });

  it('leaves the name as it is without a language', () => {
    expect(localizeSeasonName('Temporada 2', 2, undefined)).toBe('Temporada 2');
  });
});
