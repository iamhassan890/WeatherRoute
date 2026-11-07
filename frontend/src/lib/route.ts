import type { RiskLevel, RouteOption } from '../types';

type Point = [number, number];

export interface RiskSegment {
  risk: RiskLevel | null;
  positions: Point[];
}

const EARTH_RADIUS_MI = 3958.8;

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

function haversineMi([lat1, lon1]: Point, [lat2, lon2]: Point): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function checkpointEnds(route: RouteOption): number[] {
  let mile = 0;
  return route.checkpoints.map((cp) => (mile += cp.segment_mi));
}

export function riskSegments(route: RouteOption): RiskSegment[] {
  const g = route.geometry;
  const cumulative = [0];
  for (let i = 1; i < g.length; i++) cumulative.push(cumulative[i - 1] + haversineMi(g[i - 1], g[i]));
  const scale = cumulative[cumulative.length - 1] ? route.distance_mi / cumulative[cumulative.length - 1] : 1;

  const ends = checkpointEnds(route);
  const riskAtMile = (mile: number): RiskLevel | null => {
    let lo = 0;
    let hi = ends.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] < mile) lo = mid + 1;
      else hi = mid;
    }
    return route.checkpoints[lo]?.risk ?? null;
  };

  const segments: RiskSegment[] = [];
  for (let i = 0; i < g.length - 1; i++) {
    const risk = riskAtMile(((cumulative[i] + cumulative[i + 1]) / 2) * scale);
    const current = segments[segments.length - 1];
    if (current && current.risk === risk) current.positions.push(g[i + 1]);
    else segments.push({ risk, positions: [g[i], g[i + 1]] });
  }
  return segments;
}
