import type { RouteOption } from '../types';

type Point = [number, number];

const LABEL_CANDIDATES = 80;
const OTHER_ROUTE_SAMPLES = 150;
const LABEL_EDGE_MARGIN = 0.15;

export function positionAt(route: RouteOption, elapsedS: number): Point {
  const { geometry: g, times_s: t } = route;
  if (elapsedS <= t[0]) return g[0];
  if (elapsedS >= t[t.length - 1]) return g[g.length - 1];
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= elapsedS) lo = mid;
    else hi = mid;
  }
  const f = t[hi] === t[lo] ? 0 : (elapsedS - t[lo]) / (t[hi] - t[lo]);
  return [g[lo][0] + (g[hi][0] - g[lo][0]) * f, g[lo][1] + (g[hi][1] - g[lo][1]) * f];
}

function sample(points: Point[], count: number): Point[] {
  const step = Math.max(1, Math.floor(points.length / count));
  return points.filter((_, i) => i % step === 0);
}

export function labelAnchor(route: RouteOption, others: RouteOption[]): Point {
  const middle = positionAt(route, route.duration_s / 2);
  if (!others.length) return middle;

  const candidates = sample(route.geometry, LABEL_CANDIDATES);
  const first = Math.floor(candidates.length * LABEL_EDGE_MARGIN);
  const last = Math.ceil(candidates.length * (1 - LABEL_EDGE_MARGIN));
  const otherPoints = others.flatMap((other) => sample(other.geometry, OTHER_ROUTE_SAMPLES));

  let best = middle;
  let bestClearance = -1;
  for (const [lat, lon] of candidates.slice(first, last)) {
    const lonScale = Math.cos((lat * Math.PI) / 180);
    let clearance = Infinity;
    for (const [otherLat, otherLon] of otherPoints) {
      const dy = lat - otherLat;
      const dx = (lon - otherLon) * lonScale;
      clearance = Math.min(clearance, dy * dy + dx * dx);
    }
    if (clearance > bestClearance) {
      bestClearance = clearance;
      best = [lat, lon];
    }
  }
  return best;
}
