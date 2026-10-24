import * as React from 'react';

/**
 * Radix primitives portal to `document.body` by default, which is OUTSIDE our
 * Shadow DOM — a portalled Select/Popover/Dialog would then render completely
 * unstyled because the compiled Tailwind CSS only lives inside the shadow root.
 *
 * This context carries the in-shadow container element so every shadcn
 * component can pass it to `<Portal container={...}>`.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: React.ReactNode;
}) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  );
}

/** The current in-shadow portal container, or null before mount. */
export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}
