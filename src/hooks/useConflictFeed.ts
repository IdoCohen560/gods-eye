import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { fetchConflicts } from '../feeds/ConflictFeed';

interface UseConflictFeedOptions {
  viewer: Cesium.Viewer | null;
  active: boolean;
  onCountUpdate: (count: number) => void;
}

export function useConflictFeed({ viewer, active, onCountUpdate }: UseConflictFeedOptions) {
  const conflictRef = useRef<Map<string, Cesium.Entity>>(new Map());

  useEffect(() => {
    if (!viewer || !active) {
      conflictRef.current.forEach(e => viewer?.entities.remove(e));
      conflictRef.current.clear();
      if (!active) onCountUpdate(0);
      return;
    }

    let cancelled = false;
    const v = viewer;

    const load = async () => {
      try {
        // Delay to avoid GDELT rate limits
        await new Promise(r => setTimeout(r, 3000));
        if (cancelled) return;
        const events = await fetchConflicts();
        if (cancelled) return;

        for (const ev of events) {
          if (isNaN(ev.latitude) || isNaN(ev.longitude)) continue;

          const isBattle = ev.event_type.includes('Battle');
          const isExplosion = ev.event_type.includes('Explosion') || ev.event_type.includes('Remote violence');
          const isProtest = ev.event_type.includes('Protest');
          const isRiot = ev.event_type.includes('Riot');

          const color = isBattle || isExplosion ? Cesium.Color.RED
            : isRiot ? Cesium.Color.ORANGE
            : isProtest ? Cesium.Color.YELLOW
            : Cesium.Color.fromCssColorString('#ff6666');

          const size = 8;

          const entity = v.entities.add({
            position: Cesium.Cartesian3.fromDegrees(ev.longitude, ev.latitude, 0),
            point: {
              pixelSize: size,
              color: Cesium.Color.fromAlpha(color, 0.8),
              outlineColor: color,
              outlineWidth: 2,
            },
            ellipse: {
              semiMajorAxis: 30000,
              semiMinorAxis: 30000,
              material: Cesium.Color.fromAlpha(color, 0.15),
              outline: true,
              outlineColor: Cesium.Color.fromAlpha(color, 0.4),
              height: 0,
            },
            label: {
              text: `${isExplosion ? '💥' : isBattle ? '⚔' : isProtest ? '✊' : '⚠'} ${ev.event_type}`,
              font: '9px Share Tech Mono',
              fillColor: color,
              pixelOffset: new Cesium.Cartesian2(size + 4, 0),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2_000_000),
              style: Cesium.LabelStyle.FILL,
            },
            properties: { feedType: 'conflict', data: ev },
          });
          conflictRef.current.set(ev.id, entity);
        }

        onCountUpdate(events.length);
      } catch (err) { console.error('Conflict error:', err); }
    };

    load();
    return () => {
      cancelled = true;
      conflictRef.current.forEach(e => v.entities.remove(e));
      conflictRef.current.clear();
    };
  }, [viewer, active]);

  return { conflictEntities: conflictRef };
}
