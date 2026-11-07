import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { formatDateTime } from '../lib/format';
import type { HeatVariable } from '../types';

const VARIABLES: [HeatVariable, string][] = [
  ['risk', 'Risk'],
  ['wind', 'Wind'],
  ['rain', 'Rain'],
  ['snow', 'Snow'],
];
const PLAY_STEP_MS = 450;
const LABEL_CLEARANCE = 0.16;

interface Props {
  start: Date;
  hours: number;
  hour: number;
  onHour: Dispatch<SetStateAction<number>>;
  variable: HeatVariable;
  onVariable: (v: HeatVariable) => void;
  showHeatmap: boolean;
  onShowHeatmap: (show: boolean) => void;
  heatmapStatus: 'idle' | 'loading' | 'ready' | 'error';
  arrival: { hour: number; label: string } | null;
}

export function TimeControls(props: Props) {
  const { start, hours, hour, onHour, heatmapStatus, arrival } = props;
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => onHour((h) => (h >= hours ? 0 : h + 1)), PLAY_STEP_MS);
    return () => window.clearInterval(timer);
  }, [playing, hours, onHour]);

  const time = new Date(start.getTime() + hour * 3_600_000);
  const arrivalFrac = arrival && arrival.hour >= 0 && arrival.hour <= hours ? arrival.hour / hours : null;

  return (
    <div className="time-controls" role="group" aria-label="Forecast time">
      <div className="time-row">
        <button
          type="button"
          className="play"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause forecast animation' : 'Play forecast animation'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="slider">
          <input
            type="range"
            min={0}
            max={hours}
            step={1}
            value={hour}
            onChange={(e) => onHour(Number(e.target.value))}
            aria-valuetext={`Departure plus ${hour} hours, ${formatDateTime(time)}`}
          />
          <div className="slider-marks" aria-hidden>
            {(arrivalFrac == null || arrivalFrac > LABEL_CLEARANCE) && <span className="mark-start">Depart</span>}
            {arrivalFrac != null && (
              <span className="arrive" style={{ left: `${arrivalFrac * 100}%` }}>
                {arrival?.label}
              </span>
            )}
            {(arrivalFrac == null || arrivalFrac < 1 - LABEL_CLEARANCE) && <span className="mark-end">+{hours} h</span>}
          </div>
        </div>
        <output className="time-label">
          <strong>+{hour} h</strong>
          <span>{formatDateTime(time)}</span>
        </output>
      </div>
      <div className="time-row secondary">
        <div className="segmented compact" role="radiogroup" aria-label="Heatmap layer">
          {VARIABLES.map(([key, label]) => (
            <label key={key} className={props.variable === key ? 'on' : ''}>
              <input
                type="radio"
                name="heat-variable"
                checked={props.variable === key}
                onChange={() => props.onVariable(key)}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={props.showHeatmap} onChange={(e) => props.onShowHeatmap(e.target.checked)} />
          Heatmap
        </label>
        <span className="heat-status">
          {heatmapStatus === 'loading' && (
            <>
              <span className="spinner small" /> Loading corridor forecast…
            </>
          )}
          {heatmapStatus === 'error' && <span className="error-text">Heatmap unavailable</span>}
        </span>
      </div>
    </div>
  );
}
