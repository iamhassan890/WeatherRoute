import { formatDuration, formatMiles, formatTime } from '../lib/format';
import { riskColor, riskLabel } from '../lib/risk';
import type { RouteOption } from '../types';

function RiskStrip({ route }: { route: RouteOption }) {
  return (
    <div className="risk-strip" aria-hidden>
      {route.checkpoints.map((cp) => (
        <span
          key={cp.mile}
          style={{ flexGrow: cp.segment_mi, background: riskColor(cp.risk) }}
          title={`Mile ${Math.round(cp.mile)}: ${riskLabel(cp.risk)}`}
        />
      ))}
    </div>
  );
}

interface Props {
  route: RouteOption;
  selected: boolean;
  onSelect: (id: number) => void;
  delayMs?: number;
}

export function RouteCard({ route, selected, onSelect, delayMs = 0 }: Props) {
  const miles = route.summary.miles_by_level;
  const stats: [string, string, number][] = [
    ['No-Travel', formatMiles(miles[4]), miles[4]],
    ['Severe', formatMiles(miles[3]), miles[3]],
    ['High', formatMiles(miles[2]), miles[2]],
    ['Avg risk', route.summary.avg_risk == null ? '-' : route.summary.avg_risk.toFixed(2), 0],
  ];
  const classes = ['route-card', 'rise', selected && 'selected', route.recommended && 'recommended'].filter(Boolean);

  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={{ animationDelay: `${delayMs}ms` }}
      onClick={() => onSelect(route.id)}
      aria-pressed={selected}
    >
      <div className="route-card-head">
        <span className="route-badge">{route.label}</span>
        <span className="route-via">via {route.via}</span>
        {route.recommended ? <span className="tag tag-rec">★ Recommended</span> : <span className="tag">#{route.rank}</span>}
      </div>
      <div className="route-meta">
        <span className="route-meta-main">{formatDuration(route.duration_s)}</span>
        <span>{formatMiles(route.distance_mi)}</span>
        <span>Arrive {formatTime(route.arrival)}</span>
      </div>
      <RiskStrip route={route} />
      <dl className="route-stats">
        {stats.map(([label, value, raw]) => (
          <div key={label} className={raw > 0 ? 'warn' : ''}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </button>
  );
}
