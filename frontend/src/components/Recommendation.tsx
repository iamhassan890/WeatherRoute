import { formatClock, formatDuration, formatMiles, formatWeekday } from '../lib/format';
import type { PlanResponse } from '../types';
import { AlertIcon, ClockIcon, FlagIcon, RouteIcon, ShieldIcon } from './icons';

export function Recommendation({ plan }: { plan: PlanResponse }) {
  const { recommendation, routes } = plan;
  const best = routes.find((r) => r.id === recommendation.route_id);
  if (!best) return null;

  const miles = best.summary.miles_by_level;
  const hazardMiles = miles[3] + miles[4];
  const kpis = [
    { icon: <RouteIcon size={16} />, label: 'Distance', value: formatMiles(best.distance_mi) },
    { icon: <ClockIcon size={16} />, label: 'Drive time', value: formatDuration(best.duration_s) },
    { icon: <FlagIcon size={16} />, label: `Arrives ${formatWeekday(best.arrival)}`, value: formatClock(best.arrival) },
    { icon: <AlertIcon size={16} />, label: 'Severe+', value: formatMiles(hazardMiles), warn: hazardMiles > 0 },
  ];

  return (
    <section className="panel recommendation rise" aria-live="polite">
      <div className="rec-head">
        <span className="rec-badge">{best.label}</span>
        <div className="rec-title-block">
          <div className="eyebrow">
            <ShieldIcon size={14} /> Safest route
          </div>
          <div className="rec-title">via {best.via}</div>
        </div>
      </div>

      <div className="kpis">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={`kpi${kpi.warn ? ' warn' : ''}`}>
            <span className="kpi-icon">{kpi.icon}</span>
            <span className="kpi-value">{kpi.value}</span>
            <span className="kpi-label">{kpi.label}</span>
          </div>
        ))}
      </div>

      <p className="rec-reason">{recommendation.reason}</p>
      {recommendation.warnings.map((w) => (
        <div key={w} className="alert warning">
          {w}
        </div>
      ))}

      <details className="rec-criteria">
        <summary>How routes are ranked</summary>
        <ol>
          {recommendation.criteria.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <p className="muted">
          Weather is checked at each checkpoint for the time the truck gets there. Each checkpoint covers the miles
          halfway to its neighbours. Truck speed is capped at {plan.assumptions.truck_max_speed_mph} mph.
        </p>
      </details>
    </section>
  );
}
