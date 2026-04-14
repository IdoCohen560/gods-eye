import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { fetchFIRMS } from '../feeds/FIRMSFeed';

interface UseFireFeedOptions {
  viewer: Cesium.Viewer | null;
  active: boolean;
  onCountUpdate: (count: number) => void;
}

export function useFireFeed({ viewer, active, onCountUpdate }: UseFireFeedOptions) {
  const fireRef = useRef<Map<string, Cesium.Entity>>(new Map());

  useEffect(() => {
    if (!viewer || !active) {
      fireRef.current.forEach(e => viewer?.entities.remove(e));
      fireRef.current.clear();
      if (!active) onCountUpdate(0);
      return;
    }

    let cancelled = false;
    const v = viewer;

    const load = async () => {
      try {
        const hotspots = await fetchFIRMS();
        if (cancelled) return;

        for (let i = 0; i < hotspots.length; i++) {
          const h = hotspots[i];
          const color = h.confidence === 'high' ? Cesium.Color.RED
            : h.confidence === 'nominal' ? Cesium.Color.ORANGE
            : Cesium.Color.YELLOW;
          const size = Math.max(4, Math.min(12, h.frp / 10));

          const entity = v.entities.add({
            position: Cesium.Cartesian3.fromDegrees(h.longitude, h.latitude, 0),
            point: {
              pixelSize: size,
              color: color,
              outlineColor: Cesium.Color.fromAlpha(Cesium.Color.RED, 0.5),
              outlineWidth: 2,
            },
            label: {
              text: `🔥 FRP:${h.frp.toFixed(0)}`,
              font: '9px Share Tech Mono',
              fillColor: Cesium.Color.ORANGE,
              pixelOffset: new Cesium.Cartesian2(size + 4, 0),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_000_000),
              style: Cesium.LabelStyle.FILL,
            },
            properties: { feedType: 'fire', data: h },
          });
          fireRef.current.set(`fire-${i}`, entity);
        }

        onCountUpdate(hotspots.length);
      } catch (err) { console.error('FIRMS error:', err); }
    };

    load();
    return () => {
      cancelled = true;
      fireRef.current.forEach(e => v.entities.remove(e));
      fireRef.current.clear();
    };
  }, [viewer, active]);

  return { fireEntities: fireRef };
}
