/**
 * Get the display name of a language code in a target locale.
 */
export const getLanguageName = (code: string, locale: string) => {
    if (typeof Intl.DisplayNames === 'function') {
        const displayNames = new Intl.DisplayNames([locale], { type: 'language' });
        return displayNames.of(code);
    }
    return code;
};

export const iso1to3: Record<string, string> = {
    es: 'spa',
    en: 'eng',
    pt: 'por',
    fr: 'fre',
    de: 'ger',
    it: 'ita',
    ru: 'rus',
    ar: 'ara',
    ja: 'jpn',
    ko: 'kor',
    zh: 'zho',
    hi: 'hin',
    pl: 'pol',
    nl: 'dut',
    sv: 'swe',
    el: 'ell',
    cs: 'ces',
    ro: 'ron',
    fi: 'fin',
    tr: 'tur',
    th: 'tha',
    id: 'ind',
    ms: 'msa',
    ca: 'cat',
};
