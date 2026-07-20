export interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Converts a normalized (0..1, top-left origin) flat polygon into a rendered
 * bounding rectangle for the given render size.
 */
export function polygonToRect(
  polygon: number[],
  renderedWidth: number,
  renderedHeight: number,
): HighlightRect {
  const xs = polygon.filter((_, index) => index % 2 === 0);
  const ys = polygon.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    left: minX * renderedWidth,
    top: minY * renderedHeight,
    width: Math.max((maxX - minX) * renderedWidth, 2),
    height: Math.max((maxY - minY) * renderedHeight, 2),
  };
}
