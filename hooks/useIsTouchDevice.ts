import { useEffect, useState } from 'react';

export const useIsTouchDevice = () => {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateIsTouch = () => {
      const coarseMatch = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
      const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      setIsTouch(coarseMatch || touchCapable);
    };

    updateIsTouch();

    let mediaQuery: MediaQueryList | null = null;
    if (window.matchMedia) {
      mediaQuery = window.matchMedia('(pointer: coarse)');
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', updateIsTouch);
      } else if ((mediaQuery as any).addListener) {
        (mediaQuery as any).addListener(updateIsTouch);
      }
    }

    return () => {
      if (!mediaQuery) return;
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', updateIsTouch);
      } else if ((mediaQuery as any).removeListener) {
        (mediaQuery as any).removeListener(updateIsTouch);
      }
    };
  }, []);

  return isTouch;
};
