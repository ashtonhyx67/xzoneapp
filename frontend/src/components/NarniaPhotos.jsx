import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A full-screen view on the body, outside the page. Tapping anywhere closes it, so
// there is nothing to aim for with wet hands.
function Enlarged({ photo, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="narnia-enlarged" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="narnia-enlarged-close" ref={closeRef} aria-label="Close">
        ×
      </button>
      <img src={photo.url} alt={photo.caption || "The standard"} />
      {photo.caption && <p className="narnia-enlarged-caption">{photo.caption}</p>}
    </div>,
    document.body
  );
}

// The picture of what excellent looks like. A row that scrolls sideways rather than
// a grid, so a room with many of them does not push the jobs off the screen.
export default function NarniaPhotos({ photos, onRemove }) {
  const [open, setOpen] = useState(null);

  if (!photos.length) return null;

  return (
    <div className="narnia-photos">
      {photos.map((photo) => (
        <figure className="narnia-photo" key={photo.id}>
          <button
            type="button"
            className="narnia-photo-open"
            onClick={() => setOpen(photo)}
            aria-label={photo.caption ? `Enlarge: ${photo.caption}` : "Enlarge photo"}
          >
            <img src={photo.url} alt={photo.caption || "The standard"} loading="lazy" />
          </button>
          {photo.caption && <figcaption>{photo.caption}</figcaption>}
          {onRemove && (
            <button
              type="button"
              className="narnia-photo-remove"
              onClick={() => onRemove(photo)}
              aria-label="Remove this photo"
            >
              ×
            </button>
          )}
        </figure>
      ))}
      {open && <Enlarged photo={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
