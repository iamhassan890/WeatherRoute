import type { HeatmapResponse, PlanResponse, Place, TripInput } from './types';

export class ApiError extends Error {}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError('Cannot reach the server. Check your connection and try again.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(describeError(body) ?? `Request failed (HTTP ${response.status}).`);
  }
  return body as T;
}

function describeError(body: unknown, field = ''): string | null {
  if (typeof body === 'string') return field ? `${field}: ${body}` : body;
  if (Array.isArray(body)) {
    const parts = body.map((item) => describeError(item, field)).filter(Boolean);
    return parts.length ? parts.join(' ') : null;
  }
  if (body && typeof body === 'object') {
    const parts = Object.entries(body).map(([key, value]) => {
      const isGeneral = key === 'detail' || key === 'non_field_errors';
      return describeError(value, isGeneral ? field : key.replace(/_/g, ' '));
    });
    const text = parts.filter(Boolean).join(' ');
    return text || null;
  }
  return null;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const data = await request<{ results: Place[] }>(`geocode?q=${encodeURIComponent(query)}`, { signal });
  return data.results;
}

export function planTrip(trip: TripInput, signal?: AbortSignal): Promise<PlanResponse> {
  return request('plan', { method: 'POST', body: JSON.stringify(trip), signal });
}

export function fetchHeatmap(trip: TripInput, signal?: AbortSignal): Promise<HeatmapResponse> {
  return request('heatmap', { method: 'POST', body: JSON.stringify(trip), signal });
}
