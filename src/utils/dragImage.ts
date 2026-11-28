// Transparentes 1x1-GIF, um das browserseitige DragImage bei eigenen SVG-Canvas-Vorschauen auszublenden
const TRANSPARENT_PIXEL_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

let cachedTransparentDragImage: HTMLImageElement | null = null;

function getTransparentDragImage(): HTMLImageElement | null {
  if (typeof Image === "undefined") {
    return null;
  }
  if (!cachedTransparentDragImage) {
    const img = new Image();
    img.src = TRANSPARENT_PIXEL_DATA_URL;
    cachedTransparentDragImage = img;
  }
  return cachedTransparentDragImage;
}

// Vorab initialisieren, damit das Bild bereits beim ersten dragstart dekodiert vorliegt
if (typeof Image !== "undefined") {
  getTransparentDragImage();
}

export function hideBrowserDragImage(dataTransfer: DataTransfer | null | undefined): void {
  if (!dataTransfer || typeof dataTransfer.setDragImage !== "function") {
    return;
  }
  const img = getTransparentDragImage();
  if (!img) {
    return;
  }
  dataTransfer.setDragImage(img, 0, 0);
}
