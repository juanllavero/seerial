import type { AudioTrack, VideoTrack } from "../interfaces/media-info";

/** Format logos shown in the details of a movie. */
export type MediaFormatBadge =
    | "hd"
    | "4k"
    | "dolby-vision"
    | "hdr"
    | "hdr10plus"
    | "dolby-atmos"
    | "dtsx"
    | "dts-hd"
    | "dts"
    | "dolby-digital"
    | "dolby-digital-plus";

// Embedded cover art is reported as a video stream: it is not the picture of the movie
const COVER_ART_CODECS = ["MJPEG", "PNG", "BMP", "GIF"];

// Audio codecs that can carry Dolby Atmos (E-AC-3 JOC and TrueHD)
const ATMOS_CAPABLE_CODECS = ["EAC3", "TRUEHD"];

/** The track that holds the movie picture (first video track that is not cover art). */
export function getMainVideoTrack(tracks?: VideoTrack[] | null): VideoTrack | undefined {
    return tracks?.find((track) => !COVER_ART_CODECS.includes(track.codec?.toUpperCase()));
}

/**
 * Resolution logo: 4K for UHD pictures (scope releases such as 3840x1600 included) and HD from
 * 720p up. Standard definition and tracks without known dimensions get none.
 */
export function getResolutionBadge(track?: VideoTrack | null): "4k" | "hd" | undefined {
    const width = Number.parseInt(track?.codedWidth ?? "", 10);
    const height = Number.parseInt(track?.codedHeight ?? "", 10);
    if (!(width > 0) && !(height > 0)) return undefined;
    if (width >= 3000 || height >= 2000) return "4k";
    if (width >= 1200 || height >= 700) return "hd";
    return undefined;
}

export function isDolbyVisionVideoTrack(track?: VideoTrack | null): boolean {
    return track?.hasDolbyVision === true;
}

export function isHdr10PlusVideoTrack(track?: VideoTrack | null): boolean {
    return track?.hasHdr10Plus === true;
}

/** Whether the picture is HDR (HDR10, HDR10+ or HLG: all of them can show an HDR logo). */
export function isHdrVideoTrack(track?: VideoTrack | null): boolean {
    if (!track) return false;
    if (track.hdrFormat) return true;
    if (track.colorTransfer === "smpte2084" || track.colorTransfer === "arib-std-b67") return true;
    if (!track.colorTransfer && track.colorSpace === "bt2020nc") return true;
    return /\bHDR/i.test(track.displayTitle ?? "");
}

/** DTS-HD Master Audio. */
export function isDtsHdMasterAudioTrack(track?: AudioTrack | null): boolean {
    if (!track) return false;
    return track.codec?.toUpperCase() === "DTS" && track.profile === "ma";
}

export function isDtsXAudioTrack(track?: AudioTrack | null): boolean {
    return isDtsHdMasterAudioTrack(track) && track?.hasDtsX === true;
}

/** Core DTS (including DTS-ES and DTS-HD High Resolution, which have no logo of their own). */
export function isDtsCoreAudioTrack(track?: AudioTrack | null): boolean {
    return track?.codec?.toUpperCase() === "DTS" && !isDtsHdMasterAudioTrack(track);
}

export function isDolbyAtmosAudioTrack(track?: AudioTrack | null): boolean {
    return track?.hasDolbyAtmos === true;
}

/** Dolby Digital (AC-3). */
export function isDolbyDigitalAudioTrack(track?: AudioTrack | null): boolean {
    return track?.codec?.toUpperCase() === "AC3";
}

/**
 * Dolby Digital Plus (E-AC-3 without Atmos). One that was never checked for Atmos shows nothing
 * until it is analysed.
 */
export function isDolbyDigitalPlusAudioTrack(track?: AudioTrack | null): boolean {
    return track?.codec?.toUpperCase() === "EAC3" && track.hasDolbyAtmos === false;
}

/**
 * True when the media info of a movie was analysed before some format detection existed, so it
 * needs to be refreshed once: Atmos on E-AC-3/TrueHD, DTS:X on DTS-HD MA and Dolby Vision/HDR10+
 * on the picture.
 */
export function needsMediaFormatAnalysis(
    audioTracks?: AudioTrack[] | null,
    videoTracks?: VideoTrack[] | null,
): boolean {
    const audioOutdated =
        audioTracks?.some(
            (track) =>
                (ATMOS_CAPABLE_CODECS.includes(track.codec?.toUpperCase()) &&
                    track.hasDolbyAtmos === undefined) ||
                (isDtsHdMasterAudioTrack(track) && track.hasDtsX === undefined),
        ) ?? false;
    const main = getMainVideoTrack(videoTracks);
    return audioOutdated || (!!main && main.hasDolbyVision === undefined);
}

/**
 * Logos to show for the tracks that are going to play, in this order:
 * resolution (4K / HD), picture (Dolby Vision, HDR10+ or HDR: only the best one) and audio of the
 * selected track (Dolby Atmos, DTS:X, DTS-HD MA, DTS, Dolby Digital Plus or Dolby Digital).
 */
export function getMediaFormatBadges(
    videoTracks?: VideoTrack[] | null,
    selectedAudioTrack?: AudioTrack | null,
): MediaFormatBadge[] {
    const badges: MediaFormatBadge[] = [];
    const main = getMainVideoTrack(videoTracks);

    const resolution = getResolutionBadge(main);
    if (resolution) badges.push(resolution);

    if (isDolbyVisionVideoTrack(main)) badges.push("dolby-vision");
    else if (isHdr10PlusVideoTrack(main)) badges.push("hdr10plus");
    else if (isHdrVideoTrack(main)) badges.push("hdr");

    if (isDolbyAtmosAudioTrack(selectedAudioTrack)) badges.push("dolby-atmos");
    else if (isDtsXAudioTrack(selectedAudioTrack)) badges.push("dtsx");
    else if (isDtsHdMasterAudioTrack(selectedAudioTrack)) badges.push("dts-hd");
    else if (isDtsCoreAudioTrack(selectedAudioTrack)) badges.push("dts");
    else if (isDolbyDigitalPlusAudioTrack(selectedAudioTrack)) badges.push("dolby-digital-plus");
    else if (isDolbyDigitalAudioTrack(selectedAudioTrack)) badges.push("dolby-digital");

    return badges;
}
