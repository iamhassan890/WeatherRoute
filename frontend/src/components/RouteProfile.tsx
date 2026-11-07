import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { DIGITS, formatTime, formatValue } from '../lib/format';
import { riskColor, riskLabel } from '../lib/risk';
import { checkpointEnds } from '../lib/route';
import type { Checkpoint, RouteOption, Thresholds } from '../types';

const SERIES_COLOR = '#3987e5';
const GRID_COLOR = '#1e2a42';
const THRESHOLD_COLOR = '#2c3b5a';
const SURFACE = '#111a2e';
const MARGIN = { top: 6, right: 62, bottom: 22, left: 38 };
const WIND_HEIGHT = 120;
const PRECIP_HEIGHT = 46;
const PANEL_GAP = 14;
const BAND_OPACITY = 0.16;
const TOOLTIP_WIDTH = 230;
const TOOLTIP_OFFSET = 12;
const TOOLTIP_TOP = 26;
const THRESHOLD_NAMES = ['Moderate', 'High', 'Severe', 'No Travel'];

type Series = 'wind' | 'rain' | 'snow';

interface Panel {
  series: Series;
  title: string;
  unit: string;
  digits: number;
  top: number;
  height: number;
  max: number;
  bounds: number[];
  values: (number | null)[];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceStep(span: number, targetTicks: number): number {
  const raw = span / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function niceMax(value: number, floor: number): number {
  const target = Math.max(value * 1.15, floor);
  const step = niceStep(target, 4);
  return Number((Math.ceil(target / step) * step).toPrecision(6));
}

function linePath(points: [number, number | null][]): string {
  let path = '';
  let drawing = false;
  for (const [x, y] of points) {
    if (y == null) {
      drawing = false;
      continue;
    }
    path += `${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    drawing = true;
  }
  return path;
}

interface Props {
  route: RouteOption;
  thresholds: Thresholds;
  focus: Checkpoint | null;
  onFocus: (cp: Checkpoint) => void;
}

export const RouteProfile = memo(function RouteProfile({ route, thresholds, focus, onFocus }: Props) {
  const [wrapperRef, width] = useWidth<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const checkpoints = route.checkpoints;

  const panels = useMemo(() => {
    const wind = checkpoints.map((cp) => cp.wind_mph);
    const rain = checkpoints.map((cp) => cp.rain_in_hr);
    const snow = checkpoints.map((cp) => cp.snow_in_hr);
    const peak = (values: (number | null)[]) => Math.max(0, ...values.map((v) => v ?? 0));

    const result: Panel[] = [];
    let top = MARGIN.top;
    const add = (series: Series, title: string, unit: string, digits: number, height: number, values: (number | null)[], bounds: number[]) => {
      result.push({ series, title, unit, digits, top, height, values, bounds, max: niceMax(peak(values), bounds[0]) });
      top += height + PANEL_GAP;
    };
    add('wind', 'Wind', 'mph', DIGITS.wind, WIND_HEIGHT, wind, thresholds.wind.bounds);
    if (peak(rain) > 0) add('rain', 'Rain', 'in/hr', DIGITS.rain, PRECIP_HEIGHT, rain, thresholds.rain.bounds);
    if (peak(snow) > 0) add('snow', 'Snow', 'in/hr', DIGITS.snow, PRECIP_HEIGHT, snow, thresholds.snow.bounds);
    return result;
  }, [checkpoints, thresholds]);

  const plotBottom = panels[panels.length - 1].top + panels[panels.length - 1].height;
  const height = plotBottom + MARGIN.bottom;
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const x = (mile: number) => MARGIN.left + (mile / route.distance_mi) * plotWidth;
  const y = (panel: Panel, value: number) => panel.top + panel.height - (Math.min(value, panel.max) / panel.max) * panel.height;

  const ends = useMemo(() => checkpointEnds(route), [route]);
  const xStep = niceStep(route.distance_mi, 4);
  const xTicks: number[] = [];
  for (let mile = 0; mile <= route.distance_mi; mile += xStep) xTicks.push(mile);

  const focusIndex = focus ? checkpoints.findIndex((cp) => cp.lat === focus.lat && cp.lon === focus.lon) : -1;
  const activeIndex = hoverIndex ?? (focusIndex >= 0 ? focusIndex : null);
  const active = activeIndex != null ? checkpoints[activeIndex] : null;
  const windPanel = panels[0];
  const peakWindIndex = windPanel.values.reduce<number>(
    (best, v, i) => ((v ?? -1) > (windPanel.values[best] ?? -1) ? i : best),
    0,
  );
  const hasPrecip = panels.length > 1;

  const nearestIndex = (clientX: number, element: Element) => {
    const mile = ((clientX - element.getBoundingClientRect().left - MARGIN.left) / plotWidth) * route.distance_mi;
    let best = 0;
    checkpoints.forEach((cp, i) => {
      if (Math.abs(cp.mile - mile) < Math.abs(checkpoints[best].mile - mile)) best = i;
    });
    return best;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = activeIndex ?? 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = Math.min(checkpoints.length - 1, Math.max(0, current + (e.key === 'ArrowRight' ? 1 : -1)));
      setHoverIndex(next);
    } else if (e.key === 'Enter' && activeIndex != null) {
      onFocus(checkpoints[activeIndex]);
    }
  };

  const activeX = active ? x(active.mile) : 0;
  const tooltipLeft = activeX < width / 2 ? activeX + TOOLTIP_OFFSET : Math.max(0, activeX - TOOLTIP_OFFSET - TOOLTIP_WIDTH);

  return (
    <section className="panel profile">
      <h2>
        Conditions along Route {route.label}
        <small>at the truck's ETA · click to show on map</small>
      </h2>
      <div
        ref={wrapperRef}
        className="profile-chart"
        tabIndex={0}
        role="group"
        aria-label={`Wind${hasPrecip ? ', rain and snow' : ''} at each checkpoint along Route ${route.label}. Exact values are in the checkpoint table.`}
        onKeyDown={onKeyDown}
        onBlur={() => setHoverIndex(null)}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            onPointerMove={(e) => setHoverIndex(nearestIndex(e.clientX, e.currentTarget))}
            onPointerLeave={() => setHoverIndex(null)}
            onClick={(e) => onFocus(checkpoints[nearestIndex(e.clientX, e.currentTarget)])}
          >
            {checkpoints.map((cp, i) => (
              <rect
                key={`band-${cp.mile}`}
                x={x(i === 0 ? 0 : ends[i - 1])}
                y={MARGIN.top}
                width={Math.max(0, x(ends[i]) - x(i === 0 ? 0 : ends[i - 1]))}
                height={plotBottom - MARGIN.top}
                fill={riskColor(cp.risk)}
                opacity={BAND_OPACITY}
              />
            ))}

            {panels.map((panel) => {
              const points = panel.values.map((v, i): [number, number | null] => [x(checkpoints[i].mile), v == null ? null : y(panel, v)]);
              const baseline = panel.top + panel.height;
              const area = panel.series === 'wind' ? null : `${linePath(points)}L${x(route.distance_mi).toFixed(1)},${baseline}L${MARGIN.left},${baseline}Z`;
              return (
                <g key={panel.series}>
                  <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={baseline} y2={baseline} stroke={GRID_COLOR} />
                  {panel.bounds.map((bound, i) =>
                    bound <= panel.max ? (
                      <g key={bound}>
                        <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(panel, bound)} y2={y(panel, bound)} stroke={THRESHOLD_COLOR} />
                        <text x={MARGIN.left + plotWidth + 6} y={y(panel, bound) + 3.5} className="profile-threshold">
                          {THRESHOLD_NAMES[i]}
                        </text>
                      </g>
                    ) : null,
                  )}
                  <text x={MARGIN.left - 6} y={panel.top + 9} className="profile-tick" textAnchor="end">
                    {panel.max}
                  </text>
                  <text x={MARGIN.left - 6} y={baseline} className="profile-tick" textAnchor="end">
                    0
                  </text>
                  <text x={MARGIN.left + 6} y={panel.top + 12} className="profile-title">
                    {panel.title} ({panel.unit})
                  </text>
                  {area && <path d={area} fill={SERIES_COLOR} opacity={0.12} />}
                  <path d={linePath(points)} fill="none" stroke={SERIES_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}

            {windPanel.values[peakWindIndex] != null && (
              <text
                x={Math.min(x(checkpoints[peakWindIndex].mile), MARGIN.left + plotWidth - 4)}
                y={y(windPanel, windPanel.values[peakWindIndex] as number) - 7}
                className="profile-peak"
                textAnchor={x(checkpoints[peakWindIndex].mile) > MARGIN.left + plotWidth - 60 ? 'end' : 'middle'}
              >
                max {formatValue(windPanel.values[peakWindIndex], DIGITS.wind, 'mph')}
              </text>
            )}

            {xTicks.map((mile) => {
              const nearRightEdge = x(mile) > MARGIN.left + plotWidth - 28;
              return (
                <text
                  key={mile}
                  x={x(mile)}
                  y={height - 6}
                  className="profile-tick"
                  textAnchor={mile === 0 ? 'start' : nearRightEdge ? 'end' : 'middle'}
                >
                  {Math.round(mile).toLocaleString()} mi
                </text>
              );
            })}

            {active && (
              <g pointerEvents="none">
                <line x1={x(active.mile)} x2={x(active.mile)} y1={MARGIN.top} y2={plotBottom} stroke="#c7d2e3" strokeWidth={1} />
                {panels.map((panel) => {
                  const value = panel.values[activeIndex as number];
                  return value == null ? null : (
                    <circle key={panel.series} cx={x(active.mile)} cy={y(panel, value)} r={4.5} fill={SERIES_COLOR} stroke={SURFACE} strokeWidth={2} />
                  );
                })}
              </g>
            )}
          </svg>
        )}
        {active && (
          <div className="profile-tooltip" style={{ left: tooltipLeft, top: TOOLTIP_TOP, width: TOOLTIP_WIDTH }}>
            <div className="profile-tooltip-head">
              <span className="dot" style={{ background: riskColor(active.risk) }} />
              <strong>{riskLabel(active.risk)}</strong>
              <span className="muted">
                mile {Math.round(active.mile)} · {formatTime(active.eta)}
              </span>
            </div>
            {active.reasons.length > 0 && <div>{active.reasons.join(' · ')}</div>}
            <div className="muted">
              Wind {formatValue(active.wind_mph, DIGITS.wind, 'mph')} · Rain {formatValue(active.rain_in_hr, DIGITS.rain, 'in/hr')} · Snow{' '}
              {formatValue(active.snow_in_hr, DIGITS.snow, 'in/hr')}
            </div>
          </div>
        )}
      </div>
      {!hasPrecip && <p className="profile-note">No rain or snow is forecast along this route at the truck's ETAs.</p>}
    </section>
  );
});
