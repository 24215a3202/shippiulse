import React from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function LiveTrackingMap({ shipments }) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const framedRef = React.useRef(false);
  const shipmentsRef = React.useRef(shipments);
  shipmentsRef.current = shipments;

  function updateMap(map, currentShipments) {
    if (!map.isStyleLoaded() || !map.getSource('shipments')) return;
    const features = currentShipments.filter((shipment) => shipment.latestLocation).map((shipment) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [shipment.latestLocation.longitude, shipment.latestLocation.latitude] },
      properties: { trackingNumber: shipment.trackingNumber, status: shipment.status, freshness: shipment.freshness, source: shipment.latestLocation.source },
    }));
    map.getSource('shipments').setData({ type: 'FeatureCollection', features });
    if (features.length && !framedRef.current) {
      const coordinates = features.map((feature) => feature.geometry.coordinates);
      if (coordinates.length === 1 || coordinates.every(([lng, lat]) => lng === coordinates[0][0] && lat === coordinates[0][1])) {
        map.flyTo({ center: coordinates[0], zoom: 11, duration: 600 });
      } else {
        const bounds = coordinates.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: 600 });
      }
      framedRef.current = true;
    }
  }

  React.useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [78.9629, 20.5937],
      zoom: 3.5,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
            maxzoom: 19,
          },
        },
        layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }],
      },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      map.addSource('shipments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'shipment-points', type: 'circle', source: 'shipments',
        paint: {
          'circle-radius': 8,
          'circle-color': ['match', ['get', 'freshness'], 'LIVE', '#168577', 'DELAYED', '#d59a3d', 'STALE', '#aa6259', '#82949a'],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['match', ['get', 'source'], 'SIMULATOR', '#e2a82f', '#ffffff'],
        },
      });
      map.on('click', 'shipment-points', (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = feature.properties.trackingNumber;
        const status = document.createElement('p');
        status.textContent = `${feature.properties.status.replaceAll('_', ' ')} · ${feature.properties.freshness.replaceAll('_', ' ')}`;
        const source = document.createElement('small');
        source.textContent = feature.properties.source === 'SIMULATOR' ? 'SIMULATED GPS' : 'Device location';
        content.append(title, status, source);
        new maplibregl.Popup({ closeButton: true, offset: 12 }).setLngLat(event.lngLat).setDOMContent(content).addTo(map);
      });
      map.on('mouseenter', 'shipment-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'shipment-points', () => { map.getCanvas().style.cursor = ''; });
      mapRef.current = map;
      updateMap(map, shipmentsRef.current);
      map.resize();
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (map) updateMap(map, shipments);
  }, [shipments]);

  return <div className="tracking-map" ref={containerRef} role="region" aria-label="Live shipment map with the latest reported vehicle positions" />;
}
