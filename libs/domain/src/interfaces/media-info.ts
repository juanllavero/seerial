export interface PlayBackInfo {
    title: string;
    subtitle?: string;
    info?: string;
    mediaInfoData?: MediaInfoData;
    playBackConfig?: PlayBackConfig;
}

export interface PlayBackConfig {
    preferAudioLan: string;
    preferSubLan: string;
    subsMode: string;
}

export interface MediaInfoData {
    mediaInfo: MediaInfo | undefined;
    videoTracks: VideoTrack[];
    subtitleTracks: SubtitleTrack[];
    audioTracks: AudioTrack[];
    chapters: Chapter[];
    duration: number;
}

export interface AudioInfo {
    artist: string;
    album: string;
    genres: string[];
    composers: string[];
    artists: string[];
    trackNumber: number;
    discNumber: number;
    date: string;
    title: string;
    codec: string;
    duration: number;
    hasDolbyAtmos: boolean;
}

export interface MediaInfo {
    file: string;
    location: string;
    bitrate: string;
    duration: string;
    size: string;
    container: string;
}

export interface Chapter {
    title: string;
    time: number;
    displayTime: string;
    thumbnailSrc: string;
}

export interface VideoTrack {
    displayTitle: string;
    id: number;
    selected: boolean;
    codec: string;
    codecExt: string;
    bitrate: string;
    framerate: string;
    codedHeight: string;
    codedWidth: string;
    chromaLocation: string;
    colorSpace: string;
    aspectRatio: string;
    profile: string;
    refFrames: string;
    colorRange: string;
    /** Transfer characteristic reported by ffprobe (smpte2084 = PQ/HDR10, arib-std-b67 = HLG). */
    colorTransfer?: string;
    /** HDR flavour deduced from the color information: 'HDR10', 'HLG' or empty for SDR. */
    hdrFormat?: string;
    /** True when the picture carries a Dolby Vision configuration record. */
    hasDolbyVision?: boolean;
    /** True when the picture carries HDR10+ dynamic metadata (SMPTE 2094-40). */
    hasHdr10Plus?: boolean;
}

export interface AudioTrack {
    displayTitle: string;
    id: number;
    language: string;
    languageTag: string;
    selected: boolean;
    codec: string;
    codecExt: string;
    channels: string;
    channelLayout: string;
    bitrate: string;
    bitDepth: string;
    profile: string;
    samplingRate: string;
    /** True when this track carries Dolby Atmos (E-AC-3 JOC or TrueHD Atmos). */
    hasDolbyAtmos?: boolean;
    /** True when this DTS-HD MA track carries the DTS:X object layer. */
    hasDtsX?: boolean;
}

export interface SubtitleTrack {
    displayTitle: string;
    id: number;
    language: string;
    languageTag: string;
    selected: boolean;
    codec: string;
    codecExt: string;
    title: string;
    /** True when the track only translates the foreign parts of the audio. */
    forced?: boolean;
}
