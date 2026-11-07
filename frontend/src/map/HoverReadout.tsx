import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap, useMapEvents } from 'react-leaflet';
import { DIGITS, formatDateTime, formatValue } from '../lib/format';
import { riskColor, riskLabel } from '../lib/risk';
import type { HeatmapResponse, HeatVariable, RiskLevel } from '../types';

const CURSOR_OFFSET_PX = 16;

interface Props {
  data: HeatmapResponse;
  hour: number;
}

export function HoverReadout({ data, hour }: Props) {
  const map = useMap();
  const [hover, setHover] = useState<{ x: number; y: number; cell: number } | null>(null);

  const cellIndex = useMemo(() => {
    const index = new Map<number, number>();
    data.cells.forEach(([r, c], i) => index.set(r * data.grid.cols + c, i));
    return index;
  }, [data]);

  useMapEvents({
    mousemove(e) {
      const { lat0, lon0, dlat, dlon, rows, cols } = data.grid;
      const r = Math.round((e.latlng.lat - lat0) / dlat);
      const c = Math.round((e.latlng.lng - lon0) / dlon);
      const inside = r >= 0 && r < rows && c >= 0 && c < cols;
      const cell = inside ? cellIndex.get(r * cols + c) : undefined;
      setHover(cell == null ? null : { x: e.containerPoint.x, y: e.containerPoint.y, cell });
    },
    mouseout() {
      setHover(null);
    },
  });

  if (!hover) return null;
  const at = (key: HeatVariable) => data.values[key][hour][hover.cell];
  const risk = at('risk') as RiskLevel | null;
  const time = new Date(data.start).getTime() + hour * 3_600_000;
  const position = `translate(${hover.x + CURSOR_OFFSET_PX}px, ${hover.y + CURSOR_OFFSET_PX}px)`;

  return createPortal(
    <div className="hover-readout" style={{ transform: position }}>
      <div className="hover-readout-head">
        <span className="dot" style={{ background: riskColor(risk) }} />
        <strong>{riskLabel(risk)}</strong>
        <span className="muted">{formatDateTime(time)}</span>
      </div>
      <div className="muted">
        Wind {formatValue(at('wind'), DIGITS.wind, 'mph')} · Rain {formatValue(at('rain'), DIGITS.rain, 'in/hr')} ·
        Snow {formatValue(at('snow'), DIGITS.snow, 'in/hr')}
      </div>
    </div>,
    map.getContainer(),
  );
}
