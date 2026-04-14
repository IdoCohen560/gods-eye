import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { fetchEarthquakes } from '../feeds/EarthquakeFeed';

interface UseEarthquakeFeedOptions {
  viewer: Cesium.Viewer | null;
  active: boolean;
  onCountUpdate: (count: number) => void;
}

export function useEarthquakeFeed({ viewer, active, onCountUpdate }: UseEarthquakeFeedOptions) {
  const earthquakeRef = useRef<Map<string, Cesium.Entity>>(new Map());

  useEffect(() => {
    if (!viewer || !active) {
      earthquakeRef.current.forEach(e => viewer?.entities.remove(e));
      earthquakeRef.current.clear();
      if (!active) onCountUpdate(0);
      return;
    }

    let cancelled = false;
    const v = viewer;

    const load = async () => {
      try {
        const quakes = await fetchEarthquakes();
        if (cancelled) return;

        for (const q of quakes) {
          const color = q.magnitude < 4 ? Cesium.Color.YELLOW
            : q.magnitude < 6 ? Cesium.Color.ORANGE : Cesium.Color.RED;
          const size = Math.max(8, q.magnitude * 5);

          const entity = v.entities.add({
            position: Cesium.Cartesian3.fromDegrees(q.longitude, q.latitude, 0),
            ellipse: {
              semiMajorAxis: q.magnitude * 15000,
              semiMinorAxis: q.magnitude * 15000,
              material: Cesium.Color.fromAlpha(color, 0.3),
              outline: true,
              outlineColor: color,
              outlineWidth: 2,
              height: 0,
            },
            point: {
              pixelSize: size,
              color: color,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1,
            },
            label: {
              text: `M${q.magnitude.toFixed(1)} ${q.place}`,
              font: '10px Share Tech Mono',
              fillColor: color,
              pixelOffset: new Cesium.Cartesian2(size + 4, 0),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
              style: Cesium.LabelStyle.FILL,
            },
            properties: { feedType: 'earthquake', data: q },
          });
          earthquakeRef.current.set(q.id, entity);
        }

        onCountUpdate(quakes.length);
      } catch (err) { console.error('Earthquake error:', err); }
    };

    load();
    // Refresh every 5 minutes
    const interval = setInterval(load, 300_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      earthquakeRef.current.forEach(e => v.entities.remove(e));
      earthquakeRef.current.clear();
    };
  }, [viewer, active]);

  return { earthquakeEntities: earthquakeRef };
}
