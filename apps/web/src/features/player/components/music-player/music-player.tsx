import { getSignedSongStreamUrl, useGetAlbum } from '@seerial/api';
import type { Album } from '@seerial/domain';
import { useGradientStore, useMusicStore } from '@seerial/stores';
import { useEffect, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';

function MusicPlayer() {
  const { currentSong, initializeAudioRef, setAlbum } = useMusicStore(
    (state) => ({
      currentSong: state.currentSong,
      initializeAudioRef: state.initializeAudioRef,
      setAlbum: state.setAlbum,
    }),
    shallow,
  );
  const generateGradient = useGradientStore((state) => state.generateGradient);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const [audioSrc, setAudioSrc] = useState('');
  const currentSongFile = currentSong?.fileSrc;

  // Get Album details
  const { data: album } = useGetAlbum<Album>(currentSong?.albumId ?? '', {
    enabled: Boolean(currentSong?.albumId),
  });

  useEffect(() => {
    if (localAudioRef.current) {
      const cleanup = initializeAudioRef(localAudioRef);

      return cleanup;
    }
  }, [initializeAudioRef]);

  // Songs are streamed through a short-lived signed URL
  useEffect(() => {
    if (!currentSongFile) {
      setAudioSrc('');
      return;
    }

    let cancelled = false;
    getSignedSongStreamUrl({ filePath: currentSongFile, isWeb: true, expiresIn: '2m' })
      .then((url) => {
        if (!cancelled) setAudioSrc(url);
      })
      .catch(() => {
        if (!cancelled) setAudioSrc('');
      });

    return () => {
      cancelled = true;
    };
  }, [currentSongFile]);

  // Handle gradient background
  useEffect(() => {
    if (album) {
      setAlbum(album);
      generateGradient(album.coverSrc, true);
    }
  }, [album, generateGradient, setAlbum]);

  // The element is always mounted so the store can attach its listeners to it once
  return (
    <audio
      ref={localAudioRef}
      src={audioSrc || undefined}
      onError={(e) => console.error('Audio loading error:', e)}
      autoPlay
    >
      <track kind="captions" label="Captions" />
    </audio>
  );
}

export default MusicPlayer;
