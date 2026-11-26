import { useEffect, useRef, useState } from 'react';

/**
 * True while a grid is only placing the focus it starts with, which must jump there at once.
 * From the first move of the user it is false, and scrolling is animated.
 */
export function useIsRestoringFocus(focusedId: string | undefined): boolean {
  const [isRestoringFocus, setIsRestoringFocus] = useState(true);
  const initialIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!focusedId) return;

    if (initialIdRef.current === undefined) {
      initialIdRef.current = focusedId;
    } else if (initialIdRef.current !== focusedId) {
      setIsRestoringFocus(false);
    }
  }, [focusedId]);

  return isRestoringFocus;
}
