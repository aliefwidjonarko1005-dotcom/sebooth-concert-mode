// Two framing options for the digital zoom (centre crop of preview, photo and live clip)
export const DEFAULT_VIEW_ZOOM = 1.6
export const WIDE_VIEW_ZOOM = 1

export const isWideView = (zoom?: number): boolean => (zoom ?? DEFAULT_VIEW_ZOOM) <= WIDE_VIEW_ZOOM + 0.001
export const toggleViewZoom = (zoom?: number): number => (isWideView(zoom) ? DEFAULT_VIEW_ZOOM : WIDE_VIEW_ZOOM)
