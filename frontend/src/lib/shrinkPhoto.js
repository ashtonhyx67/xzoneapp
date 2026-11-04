// A phone's camera produces a file far bigger than anyone needs to see what a clean
// room looks like, and everyone in the room then downloads it over the same Wi-Fi.
// So a photo is scaled down in the browser before it is ever sent.

const MAX_EDGE = 1600;
const QUALITY = 0.82;

export async function shrinkPhoto(file, maxEdge = MAX_EDGE) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);

    const context = canvas.getContext("2d");
    // A transparent PNG would otherwise come out with a black background.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", QUALITY);
  } catch {
    throw new Error("That file couldn't be opened as a photo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
