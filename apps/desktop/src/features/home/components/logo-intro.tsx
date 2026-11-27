import { pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useSettingsStore } from '@/shared/stores';
import './logo-intro.css';

const PLAYED_KEY = 'seerial_intro_played_v2';

/**
 * Development aid: with `pnpm dev` the intro plays over and over (and is never marked as played),
 * so it can be tuned with hot reload. No effect on builds.
 */
const LOOP_IN_DEV = false;
const LOOPING = import.meta.env.DEV && LOOP_IN_DEV;
/** Black pause between two loops. */
const LOOP_GAP_MS = 600;
const WORD = 'eerial';

/** When the full timeline (see logo-intro.css) hands over to the exit. */
const EXIT_AT_MS = 3000;
const REDUCED_EXIT_AT_MS = 900;
/** Length of the exit animation, after which the intro is removed. */
const EXIT_MS = 950;
const REDUCED_EXIT_MS = 400;

type Stage = 'playing' | 'exiting';

const LogoIntro = () => {
  const reduceAnimations = useSettingsStore((state) => state.settings.reduceAnimations);
  const [hasPlayed, setHasPlayed] = useState(
    () => !LOOPING && sessionStorage.getItem(PLAYED_KEY) === 'true',
  );
  const [stage, setStage] = useState<Stage>('playing');
  // Remounts the intro (its CSS animations start over) on every loop
  const [cycle, setCycle] = useState(0);
  const [shift, setShift] = useState(0);
  const wordRef = useRef<HTMLDivElement>(null);

  // The S starts centered on screen: it has to move by half the width of the name
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again on every loop
  useLayoutEffect(() => {
    if (hasPlayed || !wordRef.current) return;
    setShift(wordRef.current.offsetWidth / 2);
  }, [hasPlayed, cycle]);

  const exit = useCallback(() => setStage('exiting'), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restarts the timeline on every loop
  useEffect(() => {
    if (hasPlayed) return;

    // No navigation behind the intro
    pause();
    const timer = window.setTimeout(exit, reduceAnimations ? REDUCED_EXIT_AT_MS : EXIT_AT_MS);

    // Any key or click skips it
    window.addEventListener('keydown', exit);
    window.addEventListener('mousedown', exit);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', exit);
      window.removeEventListener('mousedown', exit);
      resume();
    };
  }, [hasPlayed, exit, reduceAnimations, cycle]);

  useEffect(() => {
    if (stage !== 'exiting') return;

    const timer = window.setTimeout(
      () => {
        if (LOOPING) {
          setStage('playing');
          setCycle((current) => current + 1);
          return;
        }
        sessionStorage.setItem(PLAYED_KEY, 'true');
        setHasPlayed(true);
      },
      (reduceAnimations ? REDUCED_EXIT_MS : EXIT_MS) + (LOOPING ? LOOP_GAP_MS : 0),
    );
    return () => window.clearTimeout(timer);
  }, [stage, reduceAnimations]);

  if (hasPlayed) return null;

  const className = [
    'seerial-intro',
    stage === 'exiting' && 'seerial-intro--exit',
    reduceAnimations && 'seerial-intro--reduced',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div key={cycle} className={className} aria-hidden="true">
      <div className="seerial-intro__lockup">
        <div
          className="seerial-intro__mark-slot"
          style={{ '--shift': `${shift}px` } as CSSProperties}
        >
          <img className="seerial-intro__mark" src="/img/seerial-mark.png" alt="" />
          <div className="seerial-intro__shine" />
        </div>
        <div ref={wordRef} className="seerial-intro__word">
          {WORD.split('').map((letter, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed word, letters repeat
              key={index}
              className="seerial-intro__letter"
              style={{ '--i': index } as CSSProperties}
            >
              {letter}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LogoIntro;
