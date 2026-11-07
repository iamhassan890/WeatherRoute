import L from 'leaflet';
import { buildColorRamp, MAX_RISK } from '../lib/risk';

export interface ScalarField {
  lat0: number;
  lon0: number;
  dlat: number;
  dlon: number;
  rows: number;
  cols: number;
  values: Float32Array;
}

const SAMPLES_PER_TILE = 64;
const RAMP_SIZE = 256;
const RAMP = buildColorRamp(RAMP_SIZE);
const MIN_COVERAGE = 0.02;
const EDGE_FADE = 1.6;

type TileRecord = { el: HTMLCanvasElement; coords: L.Coords };

export class HeatTileLayer extends L.GridLayer {
  private field: ScalarField | null = null;
  private mapRef: L.Map | null = null;
  private readonly lowRes: HTMLCanvasElement;
  private readonly image = new ImageData(SAMPLES_PER_TILE, SAMPLES_PER_TILE);

  constructor(options?: L.GridLayerOptions) {
    super(options);
    this.lowRes = document.createElement('canvas');
    this.lowRes.width = this.lowRes.height = SAMPLES_PER_TILE;
  }

  onAdd(map: L.Map): this {
    this.mapRef = map;
    return super.onAdd(map);
  }

  setField(field: ScalarField | null): void {
    this.field = field;
    const tiles = (this as unknown as { _tiles?: Record<string, TileRecord> })._tiles ?? {};
    for (const tile of Object.values(tiles)) this.paint(tile.el, tile.coords);
  }

  createTile(coords: L.Coords): HTMLElement {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    this.paint(tile, coords);
    return tile;
  }

  private paint(tile: HTMLCanvasElement, coords: L.Coords): void {
    const ctx = tile.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, tile.width, tile.height);
    const { field, mapRef: map } = this;
    if (!field || !map) return;

    const n = SAMPLES_PER_TILE;
    const step = tile.width / n;
    const originX = coords.x * tile.width;
    const originY = coords.y * tile.height;
    const lons = new Float64Array(n);
    const lats = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const offset = (i + 0.5) * step;
      lons[i] = map.unproject([originX + offset, originY], coords.z).lng;
      lats[i] = map.unproject([originX, originY + offset], coords.z).lat;
    }

    const { rows, cols, values } = field;
    let sum = 0;
    let weight = 0;
    const add = (value: number, w: number) => {
      if (!Number.isNaN(value)) {
        sum += value * w;
        weight += w;
      }
    };

    const pixels = this.image.data;
    pixels.fill(0);
    let painted = false;

    for (let y = 0; y < n; y++) {
      const fr = (lats[y] - field.lat0) / field.dlat;
      if (fr < 0 || fr > rows - 1) continue;
      const r0 = Math.floor(fr);
      const r1 = Math.min(r0 + 1, rows - 1);
      const tr = fr - r0;

      for (let x = 0; x < n; x++) {
        const fc = (lons[x] - field.lon0) / field.dlon;
        if (fc < 0 || fc > cols - 1) continue;
        const c0 = Math.floor(fc);
        const c1 = Math.min(c0 + 1, cols - 1);
        const tc = fc - c0;

        sum = 0;
        weight = 0;
        add(values[r0 * cols + c0], (1 - tr) * (1 - tc));
        add(values[r0 * cols + c1], (1 - tr) * tc);
        add(values[r1 * cols + c0], tr * (1 - tc));
        add(values[r1 * cols + c1], tr * tc);
        if (weight < MIN_COVERAGE) continue;

        const value = Math.min(Math.max(sum / weight, 0), MAX_RISK);
        const color = Math.round((value / MAX_RISK) * (RAMP_SIZE - 1)) * 4;
        const o = (y * n + x) * 4;
        pixels[o] = RAMP[color];
        pixels[o + 1] = RAMP[color + 1];
        pixels[o + 2] = RAMP[color + 2];
        pixels[o + 3] = RAMP[color + 3] * Math.min(1, weight * EDGE_FADE);
        painted = true;
      }
    }
    if (!painted) return;

    this.lowRes.getContext('2d')?.putImageData(this.image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.lowRes, 0, 0, tile.width, tile.height);
  }
}
