import { type RefObject, useEffect } from 'react';

/**
 * Spatial navigation moves the focus without touching the DOM focus, so the browser never scrolls
 * the settings list: bring the focused control into view ourselves.
 */
export function useScrollIntoViewOnFocus(ref: RefObject<HTMLElement | null>, focused: boolean) {
  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focused, ref]);
}
