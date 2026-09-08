// The spreadsheet stores photos as Google Drive share links, which point at a
// viewer page rather than an image — dropping one into <img src> shows nothing.
// Drive's thumbnail endpoint serves the actual bytes for the same file id.
//
// The file still has to be shared as "anyone with the link", otherwise Drive
// returns a sign-in page and the <img> fails; PersonCard falls back to initials.

const DRIVE_PATTERNS = [
  /\/file\/d\/([A-Za-z0-9_-]{10,})/, // .../file/d/<id>/view
  /[?&]id=([A-Za-z0-9_-]{10,})/, // ...open?id=<id>
];

export function photoSrc(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  if (value.includes("drive.google.com") || value.includes("docs.google.com")) {
    for (const pattern of DRIVE_PATTERNS) {
      const match = value.match(pattern);
      if (match) {
        return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w600`;
      }
    }
  }

  // A bare file id pasted straight from Drive.
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) {
    return `https://drive.google.com/thumbnail?id=${value}&sz=w600`;
  }

  return value;
}

export function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
