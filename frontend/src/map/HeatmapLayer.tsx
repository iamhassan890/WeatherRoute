import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { severity } from '../lib/risk';
import type { HeatmapResponse, HeatVariable, Thresholds } from '../types';
import { HeatTileLayer, type ScalarField } from './HeatTileLayer';

const PANE = 'heatmap';
const PANE_Z_INDEX = '350';
const NEIGHBOURHOOD = 9;

export function buildField(
  data: HeatmapResponse,
  hour: number,
  variable: HeatVariable,
  thresholds: Thresholds,
): ScalarField {
  const { rows, cols } = data.grid;
  const measured = new Float32Array(rows * cols).fill(NaN);
  const frame = data.values[variable][hour];
  const bounds = variable === 'risk' ? null : thresholds[variable].bounds;
  data.cells.forEach(([r, c], i) => {
    const v = frame[i];
    if (v != null) measured[r * cols + c] = bounds ? severity(v, bounds) : v;
  });

  const values = new Float32Array(rows * cols).fill(NaN);
  const coverage = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          const v = measured[rr * cols + cc];
          if (Number.isNaN(v)) continue;
          sum += v;
          count++;
        }
      }
      const i = r * cols + c;
      coverage[i] = count / NEIGHBOURHOOD;
      values[i] = Number.isNaN(measured[i]) ? (count ? sum / count : NaN) : measured[i];
    }
  }
  return { ...data.grid, values, coverage };
}

interface Props {
  data: HeatmapResponse | null;
  thresholds: Thresholds | null;
  hour: number;
  variable: HeatVariable;
  visible: boolean;
}

export function HeatmapLayer({ data, thresholds, hour, variable, visible }: Props) {
  const map = useMap();
  const layerRef = useRef<HeatTileLayer | null>(null);

  useEffect(() => {
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE);
      pane.style.zIndex = PANE_Z_INDEX;
      pane.style.pointerEvents = 'none';
    }
    const layer = new HeatTileLayer({ pane: PANE, updateWhenZooming: false, keepBuffer: 2 });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [map]);

  const field = useMemo(
    () => (data && thresholds && visible ? buildField(data, hour, variable, thresholds) : null),
    [data, thresholds, hour, variable, visible],
  );

  useEffect(() => {
    layerRef.current?.setField(field);
  }, [field]);

  return null;
}
