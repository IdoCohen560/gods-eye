import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { AIRCRAFT_POLL_INTERVAL } from '../config/constants';
import { fetchAircraft } from '../feeds/AircraftFeed';

interface UseAircraftFeedOptions {
  viewer: Cesium.Viewer | null;
  active: boolean;
  onCountUpdate: (count: number) => void;
}

function createAircraftIcon(color: Cesium.Color): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgba(${color.red*255},${color.green*255},${color.blue*255},1)`;
  ctx.beginPath(); ctx.moveTo(8,0); ctx.lineTo(14,12); ctx.lineTo(8,9); ctx.lineTo(2,12); ctx.closePath(); ctx.fill();
  return c;
}

export function useAircraftFeed({ viewer, active, onCountUpdate }: UseAircraftFeedOptions) {
  const aircraftRef = useRef<Map<string, Cesium.Entity>>(new Map());

  useEffect(() => {
    if (!viewer || !active) {
      aircraftRef.current.forEach(e => viewer?.entities.remove(e));
      aircraftRef.current.clear();
      if (!active) onCountUpdate(0);
      return;
    }

    let cancelled = false;
    const v = viewer;

    const poll = async () => {
      if (cancelled) return;
      try {
        const rect = v.camera.computeViewRectangle();
        if (!rect) return;
        const bounds = {
          lamin: Math.max(-90, Cesium.Math.toDegrees(rect.south)),
          lomin: Math.max(-180, Cesium.Math.toDegrees(rect.west)),
          lamax: Math.min(90, Cesium.Math.toDegrees(rect.north)),
          lomax: Math.min(180, Cesium.Math.toDegrees(rect.east)),
        };
        // Skip if viewing entire globe (waste of API credits)
        if (bounds.lamax - bounds.lamin > 90) return;

        const aircraft = await fetchAircraft(bounds);
        if (cancelled) return;
        const ids = new Set<string>();

        for (const ac of aircraft) {
          if (ac.longitude === null || ac.latitude === null) continue;
          ids.add(ac.icao24);
          const pos = Cesium.Cartesian3.fromDegrees(ac.longitude, ac.latitude, ac.baro_altitude || 0);
          const existing = aircraftRef.current.get(ac.icao24);

          if (existing) {
            existing.position = new Cesium.ConstantPositionProperty(pos);
            if (existing.billboard) {
              existing.billboard.rotation = new Cesium.ConstantProperty(-Cesium.Math.toRadians(ac.true_track || 0));
            }
          } else {
            const alt = ac.baro_altitude || 0;
            const color = alt < 3000 ? Cesium.Color.LIME : alt < 10000 ? Cesium.Color.YELLOW : Cesium.Color.RED;
            const entity = v.entities.add({
              position: pos,
              billboard: {
                image: createAircraftIcon(color),
                width: 16, height: 16,
                rotation: -Cesium.Math.toRadians(ac.true_track || 0),
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
              },
              label: {
                text: ac.callsign?.trim() || ac.icao24,
                font: '10px Share Tech Mono',
                fillColor: Cesium.Color.fromAlpha(Cesium.Color.WHITE, 0.8),
                pixelOffset: new Cesium.Cartesian2(0, -14),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 500_000),
                style: Cesium.LabelStyle.FILL,
              },
              properties: { feedType: 'aircraft', data: ac },
            });
            aircraftRef.current.set(ac.icao24, entity);
          }
        }

        for (const [id, e] of aircraftRef.current) {
          if (!ids.has(id)) { v.entities.remove(e); aircraftRef.current.delete(id); }
        }
        onCountUpdate(ids.size);
      } catch (err) { console.error('Aircraft error:', err); }
    };

    poll();
    const interval = setInterval(poll, AIRCRAFT_POLL_INTERVAL);
    return () => { cancelled = true; clearInterval(interval); };
  }, [viewer, active]);

  return { aircraftEntities: aircraftRef };
}
