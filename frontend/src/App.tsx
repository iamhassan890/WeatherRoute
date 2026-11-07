import { useCallback, useRef, useState } from 'react';
import { fetchHeatmap, isAbort, planTrip } from './api';
import { CheckpointTable } from './components/CheckpointTable';
import { CloudIcon, RouteIcon, ScaleIcon, TruckIcon } from './components/icons';
import { Legend } from './components/Legend';
import { Recommendation } from './components/Recommendation';
import { RouteCard } from './components/RouteCard';
import { RouteProfile } from './components/RouteProfile';
import { TimeControls } from './components/TimeControls';
import { TripForm } from './components/TripForm';
import { formatDateTime } from './lib/format';
import { MapView } from './map/MapView';
import type { Checkpoint, HeatmapResponse, HeatVariable, PlanResponse, TripInput } from './types';

const DEFAULT_HOURS = 48;
const SKELETON_CARDS = 3;
type HeatmapStatus = 'idle' | 'loading' | 'ready' | 'error';

function floorToHour(iso: string): Date {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

const shortName = (label: string) => label.split(',')[0];

function Brand() {
  return (
    <header className="brand">
      <span className="brand-logo">
        <TruckIcon size={24} />
      </span>
      <div>
        <h1>
          Weather<span className="brand-accent">Route</span>
        </h1>
        <p>Weather-safe truck routing</p>
      </div>
      <span className="live-pill">
        <span className="live-dot" /> Live forecast
      </span>
    </header>
  );
}

function HowItWorks() {
  const steps = [
    { icon: <RouteIcon />, title: 'Three routes', text: 'We look up three route options between your two places.' },
    { icon: <CloudIcon />, title: 'Weather at your ETA', text: 'Conditions are checked every 10, 25 or 50 miles, at the time you get there.' },
    { icon: <ScaleIcon />, title: 'Load-aware risk', text: 'Wind, rain and snow are scored with the load-weight rules.' },
  ];
  return (
    <section className="panel how-it-works rise">
      <h2>How it works</h2>
      <ul>
        {steps.map((step) => (
          <li key={step.title}>
            <span className="step-icon">{step.icon}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <div className="skeleton-list" aria-hidden>
      <div className="skeleton skeleton-tall" />
      {Array.from({ length: SKELETON_CARDS }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

export default function App() {
  const [trip, setTrip] = useState<TripInput | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [heatmapStatus, setHeatmapStatus] = useState<HeatmapStatus>('idle');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hour, setHour] = useState(0);
  const [variable, setVariable] = useState<HeatVariable>('risk');
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [focus, setFocus] = useState<Checkpoint | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const handlePlan = useCallback(async (input: TripInput) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setPlanning(true);
    setError(null);
    try {
      const result = await planTrip(input, controller.signal);
      setTrip(input);
      setPlan(result);
      setSelectedId(result.recommendation.route_id);
      setFocus(null);
      setHour(0);
      setHeatmap(null);
      setHeatmapStatus('loading');
    } catch (err) {
      if (!isAbort(err)) setError(err instanceof Error ? err.message : 'Planning failed.');
      return;
    } finally {
      if (inFlight.current === controller) setPlanning(false);
    }

    try {
      setHeatmap(await fetchHeatmap(input, controller.signal));
      setHeatmapStatus('ready');
    } catch (err) {
      if (!isAbort(err)) setHeatmapStatus('error');
    }
  }, []);

  const selected = plan?.routes.find((r) => r.id === selectedId) ?? null;
  const sliderStart = heatmap ? new Date(heatmap.start) : trip ? floorToHour(trip.departure) : null;
  const hours = heatmap?.hours ?? DEFAULT_HOURS;
  const sliderTime = sliderStart ? sliderStart.getTime() + hour * 3_600_000 : null;
  const truckElapsedS = trip && sliderTime != null ? (sliderTime - new Date(trip.departure).getTime()) / 1000 : null;
  const arrival =
    selected && sliderStart
      ? {
          hour: (new Date(selected.arrival).getTime() - sliderStart.getTime()) / 3_600_000,
          label: `Arrive ${selected.label}`,
        }
      : null;

  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        <TripForm busy={planning} onSubmit={handlePlan} onAttempt={clearError} />
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        {plan ? (
          <>
            <Recommendation plan={plan} />
            <section className="route-list" aria-label="Route options">
              <h2 className="section-title">Route options</h2>
              {plan.routes.map((route, i) => (
                <RouteCard
                  key={route.id}
                  route={route}
                  selected={route.id === selectedId}
                  onSelect={setSelectedId}
                  delayMs={i * 60}
                />
              ))}
            </section>
            {selected && <RouteProfile route={selected} thresholds={plan.thresholds} focus={focus} onFocus={setFocus} />}
            {selected && <CheckpointTable route={selected} intervalMi={plan.request.interval_mi} onFocus={setFocus} />}
          </>
        ) : planning ? (
          <ResultsSkeleton />
        ) : (
          <HowItWorks />
        )}
      </aside>

      <main className="map-area">
        <MapView
          routes={plan?.routes ?? []}
          endpoints={trip ? { origin: trip.origin, destination: trip.destination } : null}
          selectedId={selectedId}
          onSelect={setSelectedId}
          heatmap={heatmap}
          thresholds={plan?.thresholds ?? null}
          showHeatmap={showHeatmap}
          hour={hour}
          variable={variable}
          truckElapsedS={truckElapsedS}
          focus={focus}
        />

        {trip && plan && (
          <div className="trip-chip">
            <span className="trip-chip-route">
              <span className="endpoint-dot endpoint-dot-origin" /> {shortName(trip.origin.label)}
              <span className="trip-chip-arrow">→</span>
              <span className="endpoint-dot endpoint-dot-destination" /> {shortName(trip.destination.label)}
            </span>
            <span className="trip-chip-meta">
              {formatDateTime(trip.departure)} · {trip.load_lb.toLocaleString()} lb · every {trip.interval_mi} mi
            </span>
          </div>
        )}

        {!plan && !planning && (
          <div className="map-welcome rise">
            <span className="brand-logo large">
              <TruckIcon size={30} />
            </span>
            <h2>Plan a weather-safe trip</h2>
            <p>Pick an origin and destination to compare three routes, weather along the way, and a 48-hour forecast.</p>
          </div>
        )}

        {plan && sliderStart && (
          <TimeControls
            start={sliderStart}
            hours={hours}
            hour={hour}
            onHour={setHour}
            variable={variable}
            onVariable={setVariable}
            showHeatmap={showHeatmap}
            onShowHeatmap={setShowHeatmap}
            heatmapStatus={heatmapStatus}
            arrival={arrival}
          />
        )}
        {plan && <Legend variable={variable} thresholds={plan.thresholds} />}
        {planning && (
          <div className="map-busy" role="status">
            <span className="spinner" /> Planning routes and checking the forecast…
          </div>
        )}
      </main>
    </div>
  );
}
