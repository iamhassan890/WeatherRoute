import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { CircleMarker, MapContainer, Marker, Pane, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet';
import { positionAt } from '../lib/route';
import type { Checkpoint, HeatmapResponse, HeatVariable, Place, RouteOption, Thresholds } from '../types';
import { HeatmapLayer } from './HeatmapLayer';
import { HoverReadout } from './HoverReadout';
import { RouteLayers } from './RouteLayers';

const ESRI_CANVAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const BASEMAP_URL = `${ESRI_CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const LABELS_URL = `${ESRI_CANVAS}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ACCENT = '#38bdf8';
const MAX_ZOOM = 16;
const ATTRIBUTION =
  '&copy; Esri, HERE, Garmin, <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://project-osrm.org/">OSRM</a> · <a href="https://open-meteo.com/">Open-Meteo</a>';

const LABELS_PANE = 'labels';
const LABELS_Z_INDEX = 380;
const LABELS_REVEAL_DELAY_MS = 300;
const FIT_PADDING: [number, number] = [56, 56];
const FOCUS_ZOOM = 8;

const icon = (className: string, html = '') =>
  L.divIcon({ className: '', html: `<div class="${className}">${html}</div>`, iconSize: [0, 0] });

const ORIGIN_ICON = icon('endpoint endpoint-origin');
const DESTINATION_ICON = icon('endpoint endpoint-destination');
const TRUCK_ICON = icon('truck-marker', '🚚');

function LabelsLayer() {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const pane = map.getPane(LABELS_PANE);
    const layer = layerRef.current;
    if (!pane || !layer) return;
    let timer = 0;

    const hide = () => {
      window.clearTimeout(timer);
      pane.style.transition = 'none';
      pane.style.opacity = '0';
    };
    const reveal = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (layer.isLoading()) return;
        pane.style.transition = 'opacity 0.25s ease';
        pane.style.opacity = '1';
      }, LABELS_REVEAL_DELAY_MS);
    };

    map.on('zoomstart', hide);
    map.on('zoomend', reveal);
    layer.on('load', reveal);
    return () => {
      window.clearTimeout(timer);
      map.off('zoomstart', hide);
      map.off('zoomend', reveal);
      layer.off('load', reveal);
    };
  }, [map]);

  return <TileLayer ref={layerRef} url={LABELS_URL} maxZoom={MAX_ZOOM} />;
}

function FitToRoutes({ routes }: { routes: RouteOption[] }) {
  const map = useMap();
  useEffect(() => {
    if (routes.length) map.fitBounds(L.latLngBounds(routes.flatMap((r) => r.geometry)), { padding: FIT_PADDING });
  }, [map, routes]);
  return null;
}

function FocusOn({ point }: { point: Checkpoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.flyTo([point.lat, point.lon], Math.max(map.getZoom(), FOCUS_ZOOM), { duration: 0.8 });
  }, [map, point]);
  if (!point) return null;
  return (
    <CircleMarker
      center={[point.lat, point.lon]}
      radius={15}
      interactive={false}
      pathOptions={{ color: ACCENT, weight: 2, dashArray: '4 4', fill: false }}
    />
  );
}

export interface MapViewProps {
  routes: RouteOption[];
  endpoints: { origin: Place; destination: Place } | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  heatmap: HeatmapResponse | null;
  thresholds: Thresholds | null;
  showHeatmap: boolean;
  hour: number;
  variable: HeatVariable;
  truckElapsedS: number | null;
  focus: Checkpoint | null;
}

export function MapView(props: MapViewProps) {
  const { routes, endpoints, selectedId, heatmap, showHeatmap, hour, truckElapsedS } = props;
  const selected = routes.find((r) => r.id === selectedId);

  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
      minZoom={3}
      maxZoom={MAX_ZOOM}
      preferCanvas
      zoomControl={false}
      className="map"
    >
      <ZoomControl position="topright" />
      <TileLayer url={BASEMAP_URL} maxZoom={MAX_ZOOM} attribution={ATTRIBUTION} />
      <HeatmapLayer
        data={heatmap}
        thresholds={props.thresholds}
        hour={hour}
        variable={props.variable}
        visible={showHeatmap}
      />
      <Pane name={LABELS_PANE} style={{ zIndex: LABELS_Z_INDEX, pointerEvents: 'none' }}>
        <LabelsLayer />
      </Pane>

      <RouteLayers routes={routes} selectedId={selectedId} onSelect={props.onSelect} />
      <FitToRoutes routes={routes} />
      <FocusOn point={props.focus} />

      {endpoints && (
        <>
          <Marker position={[endpoints.origin.lat, endpoints.origin.lon]} icon={ORIGIN_ICON}>
            <Tooltip direction="top" offset={[0, -10]}>
              Origin: {endpoints.origin.label}
            </Tooltip>
          </Marker>
          <Marker position={[endpoints.destination.lat, endpoints.destination.lon]} icon={DESTINATION_ICON}>
            <Tooltip direction="top" offset={[0, -10]}>
              Destination: {endpoints.destination.label}
            </Tooltip>
          </Marker>
        </>
      )}
      {selected && truckElapsedS != null && (
        <Marker position={positionAt(selected, truckElapsedS)} icon={TRUCK_ICON} interactive={false} zIndexOffset={1000} />
      )}
      {heatmap && showHeatmap && <HoverReadout data={heatmap} hour={hour} />}
    </MapContainer>
  );
}
