'use client';
/**
 * MapView Molecule Component
 *
 * Interactive map using react-leaflet with OpenStreetMap tiles.
 * Supports both programmatic callbacks (onMapClick) and schema-driven
 * event dispatch (mapClickEvent) via the event bus.
 *
 * Why this file looks weird: Leaflet's core/Util.js evaluates
 * `window.requestAnimationFrame` at module load time, which crashes any
 * SSR/SSG environment (Docusaurus, Next.js RSC, etc.) the moment a
 * consumer statically imports something that transitively reaches MapView.
 * To stay SSR-safe, the actual leaflet bindings are loaded lazily inside
 * a `React.lazy(async () => …)` callback so the leaflet module is only
 * evaluated when the component is rendered for the first time, which
 * never happens on the server because Suspense shows the fallback there.
 */

import React, { lazy, Suspense } from 'react';
import type { EventEmit, A11yProps } from '@almadar/core';
import { Box } from '../../../core';
import { cn } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';

// Type-only import is erased at compile time and never pulls leaflet at runtime.
import type { LeafletMouseEvent } from 'leaflet';

import { domPassthrough } from '../../../core';
export type MapMarkerData = {
  /** Unique marker identifier */
  id: string | number;
  /** Latitude */
  lat: number;
  /** Longitude */
  lng: number;
  /** Label shown in popup */
  label?: string;
  /** Optional category for styling */
  category?: string;
};

export interface MapRouteWaypoint {
  lat: number;
  lng: number;
}

export interface MapRouteData {
  /** Unique route identifier */
  id: string | number;
  /** Ordered waypoints rendered as a polyline */
  waypoints: MapRouteWaypoint[];
  /** Stroke color (CSS color). Defaults to a theme-aware accent. */
  color?: string;
  /** Stroke weight in pixels (default 4) */
  weight?: number;
  /** Stroke opacity 0..1 (default 0.8) */
  opacity?: number;
  /** Optional dashed pattern (e.g. "8 4") */
  dashArray?: string;
  /** Label shown in a popup at the midpoint */
  label?: string;
}

export interface MapViewProps extends A11yProps {
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  /** Array of markers to display */
  markers?: MapMarkerData[];
  /** Routes (polylines with optional popups) drawn over the tile layer */
  routes?: MapRouteData[];
  /** Map center latitude */
  centerLat?: number;
  /** Map center longitude */
  centerLng?: number;
  /** Zoom level (1-18, default 13) */
  zoom?: number;
  /** Height of the map container (default "400px") */
  height?: string;
  /** Callback when a marker is clicked (programmatic use) */
  onMarkerClick?: (marker: MapMarkerData) => void;
  /** Callback when the map is clicked (programmatic use) */
  onMapClick?: (lat: number, lng: number) => void;
  /** Event name dispatched via event bus when the map is clicked. Payload: { latitude, longitude } */
  mapClickEvent?: EventEmit<{ latitude: number; longitude: number }>;
  /** Event name dispatched via event bus when a marker is clicked. Payload: full MapMarkerData spread. */
  markerClickEvent?: EventEmit<MapMarkerData>;
  /** Whether to show a pin at the clicked location */
  showClickedPin?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Show attribution (default true) */
  showAttribution?: boolean;
}

/**
 * Lazy implementation: every leaflet/react-leaflet import lives inside this
 * async callback. The callback only runs the first time React decides to
 * mount the lazy component, which happens on the client. On the server the
 * Suspense fallback renders instead and the callback is never invoked, so
 * leaflet is never required and `window.requestAnimationFrame` is never
 * evaluated.
 */
const MapViewImpl = lazy(async () => {
  const [reactLeaflet, leafletMod] = await Promise.all([
    import('react-leaflet'),
    import('leaflet'),
  ]);
  // Inject leaflet's stylesheet on the client. Done dynamically so the
  // CSS file isn't pulled into a server bundle (where it would be a
  // no-op anyway, but cleaner to keep the dependency client-side).
  await import('leaflet/dist/leaflet.css');

  const { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } = reactLeaflet;
  const L = leafletMod.default;

  // Fix default marker icon (Leaflet CSS/webpack issue). Done once per
  // page load on the client.
  const defaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
  L.Marker.prototype.options.icon = defaultIcon;

  // Pull these here so the closures below capture the correct refs.
  const { useEffect, useRef, useCallback, useState } = React;
  const { Typography } = await import('../../../core');
  const { useEventBus } = await import('../../../core');

  /** Syncs map view when center/zoom props change */
  function MapUpdater({ centerLat, centerLng, zoom }: { centerLat: number; centerLng: number; zoom: number }) {
    const map = useMap();
    const prevRef = useRef({ centerLat, centerLng, zoom });

    useEffect(() => {
      const prev = prevRef.current;
      if (prev.centerLat !== centerLat || prev.centerLng !== centerLng || prev.zoom !== zoom) {
        map.setView([centerLat, centerLng], zoom);
        prevRef.current = { centerLat, centerLng, zoom };
      }
    }, [map, centerLat, centerLng, zoom]);

    return null;
  }

  /** Handles map click events */
  function MapClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
    const map = useMap();

    useEffect(() => {
      if (!onMapClick) return;
      const handler = (e: LeafletMouseEvent) => {
        onMapClick(e.latlng.lat, e.latlng.lng);
      };
      map.on('click', handler);
      return () => { map.off('click', handler); };
    }, [map, onMapClick]);

    return null;
  }

  function MapViewInner({
    markers = [],
    routes = [],
    centerLat = 51.505,
    centerLng = -0.09,
    zoom = 13,
    height = '400px',
    onMarkerClick,
    onMapClick,
    mapClickEvent,
    markerClickEvent,
    showClickedPin = false,
    className,
    showAttribution = true,
    surface = 'auto',
    ...rest
  }: MapViewProps) {
    const contentSurface = useContentSurface(surface);
    const eventBus = useEventBus();
    const [clickedPosition, setClickedPosition] = useState<{ lat: number; lng: number } | null>(null);

    const handleMapClick = useCallback((lat: number, lng: number) => {
      if (showClickedPin) {
        setClickedPosition({ lat, lng });
      }
      onMapClick?.(lat, lng);
      if (mapClickEvent) {
        eventBus.emit(`UI:${mapClickEvent}`, { latitude: lat, longitude: lng });
      }
    }, [onMapClick, mapClickEvent, eventBus, showClickedPin]);

    const handleMarkerClick = useCallback((marker: MapMarkerData) => {
      onMarkerClick?.(marker);
      if (markerClickEvent) {
        eventBus.emit(`UI:${markerClickEvent}`, { ...marker });
      }
    }, [onMarkerClick, markerClickEvent, eventBus]);

    return contentSurface.provide(
      <Box
        {...domPassthrough(rest)}
        className={cn('relative isolate z-0 w-full overflow-hidden rounded-container', contentSurface.className, className)}
        style={{ height }}
        data-testid="map-view"
      >
        <MapContainer
          key={`map-${centerLat}-${centerLng}-${zoom}`}
          center={[centerLat, centerLng]}
          zoom={zoom}
          style={{ height: '100%', width: '100%' }}
          attributionControl={showAttribution}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution={showAttribution ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' : undefined}
          />
          <MapUpdater centerLat={centerLat} centerLng={centerLng} zoom={zoom} />
          <MapClickHandler onMapClick={handleMapClick} />
          {showClickedPin && clickedPosition && (
            <Marker position={[clickedPosition.lat, clickedPosition.lng]}>
              <Popup>
                <Typography variant="body2">
                  {clickedPosition.lat.toFixed(5)}, {clickedPosition.lng.toFixed(5)}
                </Typography>
              </Popup>
            </Marker>
          )}
          {markers.map((marker) => (
            <Marker
              key={marker.id}
              position={[marker.lat, marker.lng]}
              eventHandlers={(onMarkerClick || markerClickEvent) ? { click: () => handleMarkerClick(marker) } : undefined}
            >
              {marker.label ? (
                <Popup>
                  <Typography variant="body2">{marker.label}</Typography>
                  {marker.category ? (
                    <Typography variant="caption" className="text-muted-foreground">{marker.category}</Typography>
                  ) : null}
                </Popup>
              ) : null}
            </Marker>
          ))}
          {routes.map((route) => (
            <Polyline
              key={route.id}
              positions={route.waypoints.map((wp): [number, number] => [wp.lat, wp.lng])}
              pathOptions={{
                color: route.color ?? 'var(--primary, #2563eb)',
                weight: route.weight ?? 4,
                opacity: route.opacity ?? 0.8,
                dashArray: route.dashArray,
              }}
            >
              {route.label ? (
                <Popup>
                  <Typography variant="body2">{route.label}</Typography>
                </Popup>
              ) : null}
            </Polyline>
          ))}
        </MapContainer>
      </Box>,
    );
  }

  return { default: MapViewInner };
});

/**
 * Server-safe wrapper. Renders an empty Box on the server (or until the
 * lazy implementation finishes loading on the client) so SSR never reaches
 * the leaflet code.
 */
export function MapView(props: MapViewProps) {
  const contentSurface = useContentSurface(props.surface);
  return (
    <Suspense
      fallback={
        <Box
          {...domPassthrough(props)}
          className={cn('relative w-full overflow-hidden rounded-container', contentSurface.className ?? 'bg-muted/20', props.className)}
          style={{ height: props.height ?? '400px' }}
          data-testid="map-view"
        />
      }
    >
      <MapViewImpl {...props} />
    </Suspense>
  );
}
