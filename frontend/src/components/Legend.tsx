import { RISK_COLORS, RISK_LABELS } from '../lib/risk';
import type { HeatVariable, Thresholds } from '../types';

const GRADIENT = `linear-gradient(to right, ${RISK_COLORS.map((c, i) => `${c} ${i * 25}%`).join(', ')})`;
const TITLES: Record<HeatVariable, string> = {
  risk: 'Risk (load-adjusted)',
  wind: 'Wind speed',
  rain: 'Rain rate',
  snow: 'Snowfall rate',
};

interface Props {
  variable: HeatVariable;
  thresholds: Thresholds | null;
}

export function Legend({ variable, thresholds }: Props) {
  const spec = variable === 'risk' || !thresholds ? null : thresholds[variable];
  return (
    <div className="legend">
      <div className="legend-title">{TITLES[variable]}</div>
      {spec ? (
        <>
          <div className="legend-gradient" style={{ background: GRADIENT }} />
          <div className="legend-ticks">
            {[0, ...spec.bounds].map((b, i) => (
              <span key={b} style={{ left: `${i * 25}%` }}>
                {b}
                {i === spec.bounds.length ? '+' : ''}
              </span>
            ))}
          </div>
          <div className="legend-unit">{spec.unit} · colour bands match risk levels</div>
        </>
      ) : (
        <ul className="legend-levels">
          {RISK_LABELS.map((label, i) => (
            <li key={label}>
              <span className="swatch" style={{ background: RISK_COLORS[i] }} />
              {label}
            </li>
          ))}
        </ul>
      )}
      <div className="legend-routes">
        <span>
          <i className="line selected" /> Selected
        </span>
        <span>
          <i className="line alt" /> Alternative
        </span>
        <span>
          <i className="checkpoint-dot" /> Checkpoint (risk colour)
        </span>
        <span>🚚 Truck at slider time</span>
      </div>
    </div>
  );
}
