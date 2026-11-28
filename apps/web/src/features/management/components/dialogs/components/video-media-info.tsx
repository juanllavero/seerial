import { useGetVideo, useUpdateVideoMediaInfo } from '@seerial/api';
import type { AudioTrack, SubtitleTrack, Video, VideoTrack } from '@seerial/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Loading from '@/shared/ui/loading';

interface VideoMediaInfoProps {
  videoId: string;
}

type Field = [label: string, value: string | number | undefined];

const videoFields = (track: VideoTrack): Field[] => [
  ['Codec', track.codec],
  ['Codec Extended', track.codecExt],
  ['Bitrate', track.bitrate],
  ['Frame Rate', track.framerate],
  ['Coded Height', track.codedHeight],
  ['Coded Width', track.codedWidth],
  ['Chroma Location', track.chromaLocation],
  ['Color Space', track.colorSpace],
  ['Aspect Ratio', track.aspectRatio],
  ['Profile', track.profile],
  ['Ref Frames', track.refFrames],
  ['Color Range', track.colorRange],
  ['Display Title', track.displayTitle],
];

const audioFields = (track: AudioTrack): Field[] => [
  ['Codec', track.codec],
  ['Codec Extended', track.codecExt],
  ['Channels', track.channels],
  ['Channel Layout', track.channelLayout],
  ['Bitrate', track.bitrate],
  ['Language', track.language],
  ['Language tag', track.languageTag],
  ['Bit Depth', track.bitDepth],
  ['Profile', track.profile],
  ['Sampling Rate', track.samplingRate],
  ['Display Title', track.displayTitle],
];

const subtitleFields = (track: SubtitleTrack): Field[] => [
  ['Codec', track.codec],
  ['Codec Extended', track.codecExt],
  ['Language', track.language],
  ['Language tag', track.languageTag],
  ['Title', track.title],
  ['Display Title', track.displayTitle],
];

function Section({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <section>
      <h3 className="mb-1 text-lg font-semibold">{title}</h3>
      {fields
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="break-all">
            <span className="mr-2 text-neutral-300">{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
    </section>
  );
}

/**
 * Metadata of a video file. What is stored is shown at once, while the server reads the file again
 * in case it has changed.
 */
function VideoMediaInfo({ videoId }: VideoMediaInfoProps) {
  const { t } = useTranslation();
  const { data: video, isLoading, refetch } = useGetVideo<Video>(videoId);
  const { mutateAsync: analyze } = useUpdateVideoMediaInfo(videoId);
  const [analysis, setAnalysis] = useState<{ videoId: string; failed: boolean } | null>(null);

  useEffect(() => {
    let isActive = true;

    const run = async () => {
      const failed = await analyze().then(
        () => false,
        () => true,
      );
      if (!failed) await refetch();
      if (isActive) setAnalysis({ videoId, failed });
    };
    void run();

    return () => {
      isActive = false;
    };
  }, [videoId, analyze, refetch]);

  const analyzed = analysis?.videoId === videoId ? analysis : null;
  const info = video?.mediaInfo;

  if (!info?.file) {
    if (isLoading || !analyzed) return <Loading />;
    return <p className="p-4">{t('mediaInfoError')}</p>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {analyzed?.failed && <p className="text-amber-400">{t('mediaInfoOutdated')}</p>}
      <Section
        title="Media info"
        fields={[
          ['Duration', info.duration],
          ['File', info.file],
          ['Location', info.location],
          ['Bitrate', info.bitrate],
          ['Size', info.size],
          ['Container', info.container],
        ]}
      />
      {video?.videoTracks?.map((track) => (
        <Section key={`video-${track.id}`} title="Video" fields={videoFields(track)} />
      ))}
      {video?.audioTracks?.map((track) => (
        <Section key={`audio-${track.id}`} title="Audio" fields={audioFields(track)} />
      ))}
      {video?.subtitleTracks?.map((track) => (
        <Section key={`subtitle-${track.id}`} title="Subtitle" fields={subtitleFields(track)} />
      ))}
    </div>
  );
}

export default VideoMediaInfo;
