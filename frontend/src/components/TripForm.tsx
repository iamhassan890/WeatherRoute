import { useState } from 'react';
import { ApiError, searchPlaces } from '../api';
import { nextFullHour, toLocalInputValue } from '../lib/format';
import type { Place, SampleInterval, TripInput } from '../types';
import { PlaceInput, type PlaceValue } from './PlaceInput';

const INTERVALS: SampleInterval[] = [10, 25, 50];
const EXAMPLES: [string, string][] = [
  ['Chicago, IL', 'Denver, CO'],
  ['Dallas, TX', 'Atlanta, GA'],
];

const empty: PlaceValue = { text: '', place: null };

interface Props {
  busy: boolean;
  onSubmit: (trip: TripInput) => void;
  onAttempt?: () => void;
}

async function resolve(value: PlaceValue, role: string): Promise<Place> {
  if (value.place) return value.place;
  if (!value.text.trim()) throw new ApiError(`Enter an ${role}.`);
  const [first] = await searchPlaces(value.text.trim());
  if (!first) throw new ApiError(`Could not find "${value.text}". Try a city, address or "lat, lon".`);
  return first;
}

export function TripForm({ busy, onSubmit, onAttempt }: Props) {
  const [origin, setOrigin] = useState<PlaceValue>(empty);
  const [destination, setDestination] = useState<PlaceValue>(empty);
  const [departure, setDeparture] = useState(() => toLocalInputValue(nextFullHour()));
  const [load, setLoad] = useState('35000');
  const [sampleInterval, setSampleInterval] = useState<SampleInterval>(25);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    onAttempt?.();
    const loadLb = Number(load);
    const departureDate = new Date(departure);
    if (!Number.isFinite(loadLb) || loadLb < 0 || loadLb > 200_000) {
      setError('Load weight must be between 0 and 200,000 lb.');
      return;
    }
    if (Number.isNaN(departureDate.getTime())) {
      setError('Choose a departure date and time.');
      return;
    }
    setResolving(true);
    try {
      const [o, d] = await Promise.all([resolve(origin, 'origin'), resolve(destination, 'destination')]);
      setOrigin({ text: o.label, place: o });
      setDestination({ text: d.label, place: d });
      onSubmit({ origin: o, destination: d, departure: departureDate.toISOString(), load_lb: loadLb, interval_mi: sampleInterval });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not look up those places.');
    } finally {
      setResolving(false);
    }
  };

  const swap = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  return (
    <form className="panel trip-form" onSubmit={handleSubmit} noValidate>
      <div className="places">
        <PlaceInput label="Origin" marker="origin" value={origin} onChange={setOrigin} placeholder="City, address or lat, lon" />
        <button type="button" className="swap" onClick={swap} title="Swap origin and destination" aria-label="Swap origin and destination">
          ⇅
        </button>
        <PlaceInput label="Destination" marker="destination" value={destination} onChange={setDestination} placeholder="City, address or lat, lon" />
      </div>
      <div className="examples">
        Try:{' '}
        {EXAMPLES.map(([o, d]) => (
          <button
            key={o}
            type="button"
            className="link"
            onClick={() => {
              setOrigin({ text: o, place: null });
              setDestination({ text: d, place: null });
            }}
          >
            {o.split(',')[0]} → {d.split(',')[0]}
          </button>
        ))}
      </div>

      <div className="row-2">
        <div className="field">
          <label htmlFor="departure">Departure</label>
          <input id="departure" type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="load">Load weight</label>
          <div className="suffix-input">
            <input
              id="load"
              type="number"
              inputMode="numeric"
              min={0}
              max={200000}
              step={1000}
              value={load}
              onChange={(e) => setLoad(e.target.value)}
              required
            />
            <span>lb</span>
          </div>
        </div>
      </div>

      <fieldset className="field">
        <legend>Weather sampling interval</legend>
        <div className="segmented" role="radiogroup">
          {INTERVALS.map((mi) => (
            <label key={mi} className={sampleInterval === mi ? 'on' : ''}>
              <input type="radio" name="interval" value={mi} checked={sampleInterval === mi} onChange={() => setSampleInterval(mi)} />
              Every {mi} mi
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <button type="submit" className="primary" disabled={busy || resolving}>
        {busy || resolving ? (
          <>
            <span className="spinner small light" /> Planning routes…
          </>
        ) : (
          'Find safest route'
        )}
      </button>
    </form>
  );
}
