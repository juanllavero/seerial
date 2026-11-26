/**
 * Animated scroll that can be retargeted while it moves.
 *
 * Native smooth scrolling restarts its animation (and its slow start) on every `scrollTo`, so with a
 * navigation key held down the container barely moves until the key is released. Here each frame
 * covers a fraction of the remaining distance: a new target only changes where it is heading.
 */

export type ScrollProperty = 'scrollLeft' | 'scrollTop';

/** Time in which about two thirds of the remaining distance is covered. */
const TIME_CONSTANT_MS = 80;
/** Longest step taken into account, so a stalled frame does not turn into a jump. */
const MAX_FRAME_MS = 50;
/** Difference with the last written position that means someone else scrolled the container. */
const EXTERNAL_SCROLL_PX = 2;

interface Animation {
  property: ScrollProperty;
  target: number;
  position: number;
  written: number;
  time: number;
  frame: number;
}

const animations = new WeakMap<HTMLElement, Animation>();

/** Where the container is heading, or where it is when it is not moving. */
export function getScrollDestination(element: HTMLElement, property: ScrollProperty): number {
  const animation = animations.get(element);
  return animation?.property === property ? animation.target : element[property];
}

export function stopScrollAnimation(element: HTMLElement): void {
  const animation = animations.get(element);
  if (!animation) return;
  cancelAnimationFrame(animation.frame);
  animations.delete(element);
}

function step(element: HTMLElement, animation: Animation, now: number) {
  const { property, target } = animation;

  // The user scrolled with the wheel or the pointer: leave the container where they put it
  if (Math.abs(element[property] - animation.written) > EXTERNAL_SCROLL_PX) {
    animations.delete(element);
    return;
  }

  const elapsed = Math.min(Math.max(now - animation.time, 0), MAX_FRAME_MS);
  animation.time = now;
  animation.position += (target - animation.position) * (1 - Math.exp(-elapsed / TIME_CONSTANT_MS));

  const isArriving = Math.abs(target - animation.position) < 0.5;
  element[property] = isArriving ? target : animation.position;
  // Read back: the browser rounds and clamps what is written
  animation.written = element[property];

  if (isArriving) {
    animations.delete(element);
    return;
  }
  animation.frame = requestAnimationFrame((time) => step(element, animation, time));
}

export function scrollSmoothlyTo(
  element: HTMLElement,
  property: ScrollProperty,
  target: number,
): void {
  const current = animations.get(element);
  if (current?.property === property) {
    current.target = target;
    return;
  }

  stopScrollAnimation(element);
  const animation: Animation = {
    property,
    target,
    position: element[property],
    written: element[property],
    time: performance.now(),
    frame: 0,
  };
  animations.set(element, animation);
  animation.frame = requestAnimationFrame((time) => step(element, animation, time));
}
