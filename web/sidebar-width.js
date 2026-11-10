export const SIDEBAR_WIDTH_KEY = "media-glance.sidebar-width";

const keySteps = { ArrowLeft: -1, ArrowRight: 1 };
const plainStep = 16;
const shiftStep = 64;

export function widthLimits(viewport, rootPx = 16) {
  const min = Math.ceil(11 * rootPx);
  const max = Math.max(min, Math.floor(Math.min(40 * rootPx, 0.6 * viewport)));
  return { min, max, fallback: Math.round(17 * rootPx) };
}

export function clampWidth(width, limits) {
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
}

export function parseSavedWidth(raw, limits) {
  if (raw === null || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  return clampWidth(Number(raw), limits);
}

export function nextWidth(current, key, shiftKey, limits) {
  if (key === "Home") return limits.min;
  if (key === "End") return limits.max;
  if (!Object.hasOwn(keySteps, key)) return null;
  const step = shiftKey ? shiftStep : plainStep;
  return clampWidth(current + keySteps[key] * step, limits);
}
