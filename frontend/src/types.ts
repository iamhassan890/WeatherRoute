export interface Place {
  label: string;
  lat: number;
  lon: number;
}

export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export type SampleInterval = 10 | 25 | 50;

export interface TripInput {
  origin: Place;
  destination: Place;
  departure: string;
  load_lb: number;
  interval_mi: SampleInterval;
}

export interface Checkpoint {
  mile: number;
  lat: number;
  lon: number;
  eta: string;
  segment_mi: number;
  wind_mph: number | null;
  gust_mph: number | null;
  rain_in_hr: number | null;
  snow_in_hr: number | null;
  risk: RiskLevel | null;
  factors: { wind: RiskLevel; rain: RiskLevel; snow: RiskLevel } | null;
  reasons: string[];
}

export interface RouteSummary {
  miles_by_level: number[];
  unknown_mi: number;
  avg_risk: number | null;
  max_risk: RiskLevel | null;
}

export interface RouteOption {
  id: number;
  label: string;
  via: string;
  rank: number;
  recommended: boolean;
  distance_mi: number;
  duration_s: number;
  arrival: string;
  geometry: [number, number][];
  times_s: number[];
  summary: RouteSummary;
  checkpoints: Checkpoint[];
}

export interface ThresholdSpec {
  unit: string;
  bounds: number[];
  inclusive: boolean[];
}

export interface Thresholds {
  wind: ThresholdSpec;
  rain: ThresholdSpec;
  snow: ThresholdSpec;
}

export interface PlanResponse {
  request: { departure: string; load_lb: number; interval_mi: number };
  routes: RouteOption[];
  recommendation: {
    route_id: number;
    reason: string;
    ranking: number[];
    criteria: string[];
    warnings: string[];
  };
  thresholds: Thresholds;
  assumptions: { truck_max_speed_mph: number };
}

export type HeatVariable = 'risk' | 'wind' | 'rain' | 'snow';

export interface HeatmapGrid {
  lat0: number;
  lon0: number;
  dlat: number;
  dlon: number;
  rows: number;
  cols: number;
}

export interface HeatmapResponse {
  start: string;
  hours: number;
  buffer_mi: number;
  grid: HeatmapGrid;
  cells: [number, number][];
  values: Record<HeatVariable, (number | null)[][]>;
}
