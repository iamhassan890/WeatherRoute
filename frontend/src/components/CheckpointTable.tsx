import { DIGITS, formatTime } from '../lib/format';
import { riskColor, riskLabel } from '../lib/risk';
import type { Checkpoint, RiskLevel, RouteOption } from '../types';

function cell(value: number | null, digits: number, level: RiskLevel | undefined) {
  return (
    <td className={level ? `factor factor-${level}` : undefined}>{value == null ? '–' : value.toFixed(digits)}</td>
  );
}

interface Props {
  route: RouteOption;
  intervalMi: number;
  onFocus: (cp: Checkpoint) => void;
}

export function CheckpointTable({ route, intervalMi, onFocus }: Props) {
  return (
    <section className="panel">
      <h2>
        Checkpoints · Route {route.label}
        <small>
          {route.checkpoints.length} samples, every {intervalMi} mi at the truck's ETA
        </small>
      </h2>
      <div className="table-wrap">
        <table className="cp-table">
          <thead>
            <tr>
              <th>Mile</th>
              <th>ETA</th>
              <th title="Sustained wind, mph">Wind</th>
              <th title="Rain, in/hr">Rain</th>
              <th title="Snow, in/hr">Snow</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {route.checkpoints.map((cp) => (
              <tr key={cp.mile} onClick={() => onFocus(cp)} title={cp.reasons.join(' · ') || 'Click to show on map'}>
                <td>{Math.round(cp.mile)}</td>
                <td className="nowrap">{formatTime(cp.eta)}</td>
                {cell(cp.wind_mph, DIGITS.wind, cp.factors?.wind)}
                {cell(cp.rain_in_hr, DIGITS.rain, cp.factors?.rain)}
                {cell(cp.snow_in_hr, DIGITS.snow, cp.factors?.snow)}
                <td>
                  <span className={`risk-pill level-${cp.risk ?? 'none'}`} style={{ background: riskColor(cp.risk) }}>
                    {riskLabel(cp.risk)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
