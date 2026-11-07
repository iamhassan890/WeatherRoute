import { useEffect, useId, useRef, useState } from 'react';
import { isAbort, searchPlaces } from '../api';
import type { Place } from '../types';

export interface PlaceValue {
  text: string;
  place: Place | null;
}

const MIN_QUERY_LENGTH = 3;
const SEARCH_DELAY_MS = 250;

interface Props {
  label: string;
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  placeholder?: string;
  marker: 'origin' | 'destination';
}

interface SearchResults {
  query: string;
  places: Place[];
}

export function PlaceInput({ label, value, onChange, placeholder, marker }: Props) {
  const id = useId();
  const [results, setResults] = useState<SearchResults>({ query: '', places: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const userTyped = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = value.text.trim();
  const suggestions = !value.place && results.query === query ? results.places : [];

  useEffect(() => {
    if (!userTyped.current || value.place || query.length < MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const places = await searchPlaces(query, controller.signal);
        setResults({ query, places });
        setActive(places.length ? 0 : -1);
        setOpen(document.activeElement === inputRef.current);
      } catch (error) {
        if (!isAbort(error)) setResults({ query, places: [] });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, value.place]);

  const choose = (place: Place) => {
    userTyped.current = false;
    onChange({ text: place.label, place });
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const listId = `${id}-list`;
  const showList = open && suggestions.length > 0;
  return (
    <div className="field place-field">
      <label htmlFor={id}>{label}</label>
      <div className="place-input">
        <span className={`endpoint-dot endpoint-dot-${marker}`} aria-hidden />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={value.text}
          onChange={(e) => {
            userTyped.current = true;
            onChange({ text: e.target.value, place: null });
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        />
        {loading && <span className="spinner small" aria-label="Searching" />}
        {value.place && <span className="place-ok" title="Location selected">✓</span>}
      </div>
      {showList && (
        <ul className="suggestions" id={listId} role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={`${s.lat},${s.lon},${s.label}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseMove={() => i !== active && setActive(i)}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
