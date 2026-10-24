/*
 * src/components/RoomThumbnail.tsx
 *
 * A small square room photo shown immediately left of each room code in the
 * board row, with a magnified hover/focus preview.
 *
 * The JSON room API carries no image; photos live only on the hidden native
 * result cards (data-imgpath, a bare base64 PNG). The App harvests those into a
 * rsrcId -> imgpath map and passes each room's data: URI down here.
 *
 *   - thumbnail: ~20x20, rounded 3px, subtle border. When a room has no photo a
 *     neutral placeholder block of the SAME size renders instead, so the row
 *     alignment never shifts.
 *   - preview: ~220px wide, portalled INTO the shadow root (via the portal
 *     container) so the compiled Tailwind styles apply and it escapes the row's
 *     overflow clipping. Positioned near the cursor/cell, with a short fade.
 *     Hidden on mouseleave / blur / Escape.
 *
 * All image sources are data: URIs (no network, no remote code).
 */
import * as React from 'react';
import { createPortal } from 'react-dom';

import { usePortalContainer } from '@/lib/portal-container';

interface RoomThumbnailProps {
  /** A `data:image/png;base64,...` URI, or '' when the room has no photo. */
  src: string;
  /** Room code, used for the alt / aria text. */
  roomCode: string;
}

/** Position the preview near a point, kept inside the viewport. */
function clampToViewport(x: number, y: number, w: number, h: number) {
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const pad = 8;
  let left = x + 14; // a little to the right of the cursor
  let top = y + 14;
  if (left + w + pad > vw) left = Math.max(pad, x - w - 14);
  if (top + h + pad > vh) top = Math.max(pad, vh - h - pad);
  return { left, top };
}

export function RoomThumbnail({ src, roomCode }: RoomThumbnailProps) {
  const container = usePortalContainer();
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const btnRef = React.useRef<HTMLSpanElement>(null);
  const PREVIEW_W = 220;
  const PREVIEW_H = 220;

  const place = React.useCallback((clientX: number, clientY: number) => {
    setPos(clampToViewport(clientX, clientY, PREVIEW_W, PREVIEW_H));
  }, []);

  const show = React.useCallback(
    (clientX: number, clientY: number) => {
      place(clientX, clientY);
      setOpen(true);
    },
    [place]
  );
  const hide = React.useCallback(() => setOpen(false), []);

  // Escape closes the preview.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide]);

  const hasPhoto = !!src;

  const common = {
    onMouseEnter: (e: React.MouseEvent) => hasPhoto && show(e.clientX, e.clientY),
    onMouseMove: (e: React.MouseEvent) => hasPhoto && open && place(e.clientX, e.clientY),
    onMouseLeave: hide,
    onFocus: () => {
      if (!hasPhoto) return;
      const r = btnRef.current?.getBoundingClientRect();
      if (r) show(r.right, r.bottom);
    },
    onBlur: hide,
  };

  return (
    <>
      <span
        ref={btnRef}
        data-testid="nova-room-thumb"
        data-has-photo={hasPhoto ? '1' : '0'}
        tabIndex={hasPhoto ? 0 : -1}
        role={hasPhoto ? 'button' : undefined}
        aria-label={hasPhoto ? `Preview photo of ${roomCode}` : undefined}
        className="nova-thumb"
        {...common}
      >
        {hasPhoto ? (
          <img
            className="nova-thumb-img"
            src={src}
            alt={`${roomCode} room photo`}
            draggable={false}
            data-testid="nova-room-thumb-img"
          />
        ) : (
          <span className="nova-thumb-placeholder" aria-hidden data-testid="nova-room-thumb-placeholder" />
        )}
      </span>

      {open && hasPhoto && container
        ? createPortal(
            <div
              className="nova-thumb-preview"
              data-testid="nova-thumb-preview"
              role="img"
              aria-label={`${roomCode} room photo, enlarged`}
              style={{ left: pos.left, top: pos.top, width: PREVIEW_W }}
            >
              <img className="nova-thumb-preview-img" src={src} alt="" draggable={false} />
            </div>,
            container
          )
        : null}
    </>
  );
}
