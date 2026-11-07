import type { RiskLevel } from '../types';

export const RISK_LABELS = ['Low', 'Moderate', 'High', 'Severe', 'No Travel'] as const;
export const RISK_COLORS = ['#2f9e5b', '#e2b714', '#f07f1d', '#d62839', '#6a2c9e'] as const;
export const NO_DATA_COLOR = '#9aa0a6';
export const MAX_RISK = 4;

const CALM_ALPHA = 0.3;
const HAZARD_ALPHA = 0.72;
const FULL_ALPHA_AT_RISK = 2;

export function riskColor(level: RiskLevel | null | undefined): string {
  return level == null ? NO_DATA_COLOR : RISK_COLORS[level];
}

export function riskLabel(level: RiskLevel | null | undefined): string {
  return level == null ? 'No data' : RISK_LABELS[level];
}

export function severity(value: number, bounds: number[]): number {
  let lower = 0;
  for (let i = 0; i < bounds.length; i++) {
    if (value < bounds[i]) return i + (value - lower) / (bounds[i] - lower);
    lower = bounds[i];
  }
  return bounds.length;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function buildColorRamp(size = 256): Uint8ClampedArray {
  const stops = RISK_COLORS.map(hexToRgb);
  const ramp = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    const value = (i / (size - 1)) * MAX_RISK;
    const lo = Math.floor(value);
    const hi = Math.min(lo + 1, MAX_RISK);
    const t = value - lo;
    for (let channel = 0; channel < 3; channel++) {
      ramp[i * 4 + channel] = stops[lo][channel] + (stops[hi][channel] - stops[lo][channel]) * t;
    }
    const intensity = Math.min(value, FULL_ALPHA_AT_RISK) / FULL_ALPHA_AT_RISK;
    ramp[i * 4 + 3] = 255 * (CALM_ALPHA + (HAZARD_ALPHA - CALM_ALPHA) * intensity);
  }
  return ramp;
}
