const timeFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export const DIGITS = { wind: 1, rain: 3, snow: 2 } as const;

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

export const formatTime = (date: Date | string | number): string => timeFormat.format(new Date(date));
export const formatClock = (date: Date | string | number): string => clockFormat.format(new Date(date));
export const formatWeekday = (date: Date | string | number): string => weekdayFormat.format(new Date(date));
export const formatDateTime = (date: Date | string | number): string => dateTimeFormat.format(new Date(date));

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
}

export const formatMiles = (miles: number): string => `${Math.round(miles).toLocaleString()} mi`;

export function formatValue(value: number | null, digits: number, unit: string): string {
  return value == null ? '-' : `${value.toFixed(digits)} ${unit}`;
}

export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function nextFullHour(from = new Date()): Date {
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
