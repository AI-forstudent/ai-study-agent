import { useSyncExternalStore } from 'react';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

const PHONE_MAX_PX   = 767;
const TABLET_MAX_PX  = 1023;

const PHONE_QUERY  = `(max-width: ${PHONE_MAX_PX}px)`;
const TABLET_QUERY = `(min-width: ${PHONE_MAX_PX + 1}px) and (max-width: ${TABLET_MAX_PX}px)`;

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia(PHONE_QUERY).matches)  return 'phone';
  if (window.matchMedia(TABLET_QUERY).matches) return 'tablet';
  return 'desktop';
}

function subscribe(cb: () => void) {
  if (typeof window === 'undefined') return () => {};
  const phoneMq  = window.matchMedia(PHONE_QUERY);
  const tabletMq = window.matchMedia(TABLET_QUERY);
  phoneMq.addEventListener('change', cb);
  tabletMq.addEventListener('change', cb);
  return () => {
    phoneMq.removeEventListener('change', cb);
    tabletMq.removeEventListener('change', cb);
  };
}

export function useBreakpoint() {
  const bp = useSyncExternalStore(subscribe, getBreakpoint, () => 'desktop' as Breakpoint);
  return {
    breakpoint: bp,
    isPhone:    bp === 'phone',
    isTablet:   bp === 'tablet',
    isDesktop:  bp === 'desktop',
    isMobile:   bp === 'phone' || bp === 'tablet',
  };
}
