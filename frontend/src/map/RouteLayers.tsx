import L from 'leaflet';
import { memo, useMemo } from 'react';
import { CircleMarker, Marker, Polyline, Tooltip } from 'react-leaflet';
import { DIGITS, formatDuration, formatMiles, formatTime, formatValue } from '../lib/format';
import { riskColor, riskLabel } from '../lib/risk';
import { labelAnchor, riskSegments } from '../lib/route';
import type { Checkpoint, RouteOption } from '../types';

const ALT_STYLE = { color: '#94a3b8', weight: 4, opacity: 0.55 };
const GLOW_STYLE = { color: '#38bdf8', weight: 18, opacity: 0.2 };
const CASING_STYLE = { color: '#0b1120', weight: 9, opacity: 0.9 };
const SEGMENT_WEIGHT = 5;
const MARKER_OUTLINE = '#0b1120';
const CHECKPOINT_RADIUS = 5;
const HAZARD_CHECKPOINT_RADIUS = 7;
const ALT_CHECKPOINT_RADIUS = 3.5;
const SELECTED_LABEL_Z = 500;

function CheckpointTooltip({ cp, routeLabel }: { cp: Checkpoint; routeLabel: string }) {
  return (
    <div className="cp-tooltip">
      <div className="cp-tooltip-head">
        <span className="dot" style={{ background: riskColor(cp.risk) }} />
        <strong>{riskLabel(cp.risk)}</strong>
        <span className="muted">
          Route {routeLabel} · mile {Math.round(cp.mile)} · {formatTime(cp.eta)}
        </span>
      </div>
      {cp.reasons.length > 0 && <div>{cp.reasons.join(' · ')}</div>}
      <div className="muted">
        Wind {formatValue(cp.wind_mph, DIGITS.wind, 'mph')}
        {cp.gust_mph != null && ` (gusts ${Math.round(cp.gust_mph)})`} · Rain{' '}
        {formatValue(cp.rain_in_hr, DIGITS.rain, 'in/hr')} · Snow {formatValue(cp.snow_in_hr, DIGITS.snow, 'in/hr')}
      </div>
    </div>
  );
}

function routeLabelIcon(route: RouteOption, selected: boolean): L.DivIcon {
  const classes = ['route-label', selected ? 'selected' : '', route.recommended ? 'recommended' : '']
    .filter(Boolean)
    .join(' ');
  const star = route.recommended ? '<span class="route-label-star">★</span>' : '';
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="${classes}">
      <span class="route-label-badge">${route.label}</span>${star}
      <span>${formatDuration(route.duration_s)}</span>
      <span class="route-label-muted">${formatMiles(route.distance_mi)}</span>
      <span class="route-label-risk" style="background:${riskColor(route.summary.max_risk)}"></span>
    </div>`,
  });
}

interface Props {
  routes: RouteOption[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export const RouteLayers = memo(function RouteLayers({ routes, selectedId, onSelect }: Props) {
  const selected = routes.find((r) => r.id === selectedId);
  const others = routes.filter((r) => r.id !== selectedId);

  const selectedSegments = useMemo(() => (selected ? riskSegments(selected) : []), [selected]);

  const labelPositions = useMemo(
    () => new Map(routes.map((route) => [route.id, labelAnchor(route, routes.filter((o) => o.id !== route.id))])),
    [routes],
  );

  return (
    <>
      {others.map((route) => (
        <Polyline
          key={`alt-${route.id}`}
          positions={route.geometry}
          pathOptions={ALT_STYLE}
          eventHandlers={{ click: () => onSelect(route.id) }}
        >
          <Tooltip sticky>
            Route {route.label} via {route.via}. Click to select.
          </Tooltip>
        </Polyline>
      ))}

      {others.flatMap((route) =>
        route.checkpoints.map((cp) => (
          <CircleMarker
            key={`alt-${route.id}-${cp.mile}`}
            center={[cp.lat, cp.lon]}
            radius={ALT_CHECKPOINT_RADIUS}
            pathOptions={{ stroke: false, fillColor: riskColor(cp.risk), fillOpacity: 0.85 }}
            eventHandlers={{ click: () => onSelect(route.id) }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              <CheckpointTooltip cp={cp} routeLabel={route.label} />
            </Tooltip>
          </CircleMarker>
        )),
      )}

      {selected && (
        <>
          <Polyline key={`glow-${selected.id}`} positions={selected.geometry} pathOptions={GLOW_STYLE} interactive={false} />
          <Polyline key={`casing-${selected.id}`} positions={selected.geometry} pathOptions={CASING_STYLE} interactive={false} />
          {selectedSegments.map((segment, i) => (
            <Polyline
              key={`sel-${selected.id}-${i}`}
              positions={segment.positions}
              pathOptions={{ color: riskColor(segment.risk), weight: SEGMENT_WEIGHT, opacity: 1, lineCap: 'round' }}
              interactive={false}
            />
          ))}
          {selected.checkpoints.map((cp) => (
            <CircleMarker
              key={`${selected.id}-${cp.mile}`}
              center={[cp.lat, cp.lon]}
              radius={cp.risk != null && cp.risk >= 2 ? HAZARD_CHECKPOINT_RADIUS : CHECKPOINT_RADIUS}
              pathOptions={{ color: MARKER_OUTLINE, weight: 1.5, fillColor: riskColor(cp.risk), fillOpacity: 1 }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <CheckpointTooltip cp={cp} routeLabel={selected.label} />
              </Tooltip>
            </CircleMarker>
          ))}
        </>
      )}

      {routes.map((route) => {
        const position = labelPositions.get(route.id);
        if (!position) return null;
        const isSelected = route.id === selectedId;
        return (
          <Marker
            key={`label-${route.id}`}
            position={position}
            icon={routeLabelIcon(route, isSelected)}
            title={`Route ${route.label} via ${route.via}`}
            zIndexOffset={isSelected ? SELECTED_LABEL_Z : 0}
            eventHandlers={{ click: () => onSelect(route.id) }}
          />
        );
      })}
    </>
  );
});
