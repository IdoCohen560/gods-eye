import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { SATELLITE_UPDATE_INTERVAL } from '../config/constants';
import { fetchSatellites, propagateAll, type SatelliteRecord } from '../feeds/SatelliteFeed';

interface UseSatelliteFeedOptions {
  viewer: Cesium.Viewer | null;
  active: boolean;
  onCountUpdate: (count: number) => void;
}

const SAT_COLORS: Record<string, Cesium.Color> = {
  station: Cesium.Color.WHITE,
  gps: Cesium.Color.DODGERBLUE,
  weather: Cesium.Color.YELLOW,
  military: Cesium.Color.RED,
  starlink: Cesium.Color.fromCssColorString('#33ff33'),
  visual: Cesium.Color.CYAN,
  other: Cesium.Color.CYAN,
};

const SAT_SIZES: Record<string, number> = {
  station: 12, gps: 6, weather: 6, military: 8, starlink: 3, visual: 6, other: 5,
};

export function useSatelliteFeed({ viewer, active, onCountUpdate }: UseSatelliteFeedOptions) {
  const satelliteRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const orbitRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const satDataRef = useRef<SatelliteRecord[]>([]);

  useEffect(() => {
    const v = viewer;

    // Always clean up first
    const cleanup = () => {
      if (v && !v.isDestroyed()) {
        satelliteRef.current.forEach(e => { try { v.entities.remove(e); } catch {} });
        orbitRef.current.forEach(e => { try { v.entities.remove(e); } catch {} });
      }
      satelliteRef.current.clear();
      orbitRef.current.clear();
    };

    cleanup();

    if (!v || !active) {
      onCountUpdate(0);
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const sats = await fetchSatellites();
        if (cancelled) return;
        satDataRef.current = sats;

        const positions = propagateAll(sats, new Date());
        let count = 0;

        for (const sat of positions) {
          if (cancelled) break;
          if (!sat.position) continue;
          count++;
          const color = SAT_COLORS[sat.category] || Cesium.Color.CYAN;
          const size = SAT_SIZES[sat.category] || 5;
          const pos = Cesium.Cartesian3.fromDegrees(
            sat.position.longitude, sat.position.latitude, sat.position.altitude * 1000
          );

          const entity = v.entities.add({
            position: pos,
            point: {
              pixelSize: size,
              color: color,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: sat.category === 'station' ? 2 : 1,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
                0, sat.category === 'starlink' ? 5_000_000 : 30_000_000
              ),
            },
            label: {
              text: sat.name,
              font: `${sat.category === 'station' ? 11 : 9}px Share Tech Mono`,
              fillColor: color,
              pixelOffset: new Cesium.Cartesian2(size + 4, 0),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
                0, sat.category === 'starlink' ? 2_000_000 : 10_000_000
              ),
              style: Cesium.LabelStyle.FILL,
            },
            properties: { feedType: 'satellite', data: sat },
          });
          satelliteRef.current.set(sat.name, entity);

          // Orbit path (skip starlink)
          if (sat.orbitPath.length > 2) {
            const pathPositions = sat.orbitPath.map(p =>
              Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude * 1000)
            );
            const orbitEntity = v.entities.add({
              polyline: {
                positions: pathPositions,
                width: sat.category === 'station' ? 2 : 1,
                material: new Cesium.PolylineDashMaterialProperty({
                  color: Cesium.Color.fromAlpha(color, 0.4),
                  dashLength: 16,
                }),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 30_000_000),
              },
            });
            orbitRef.current.set(sat.name, orbitEntity);
          }
        }

        onCountUpdate(count);
      } catch (err) { console.error('Satellite error:', err); }
    };

    init();

    const interval = setInterval(() => {
      if (cancelled) return;
      const positions = propagateAll(satDataRef.current, new Date());
      for (const sat of positions) {
        if (!sat.position) continue;
        const entity = satelliteRef.current.get(sat.name);
        if (entity) {
          entity.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(sat.position.longitude, sat.position.latitude, sat.position.altitude * 1000)
          );
        }
      }
    }, SATELLITE_UPDATE_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
      cleanup();
    };
  }, [viewer, active]);

  return { satelliteEntities: satelliteRef };
}
