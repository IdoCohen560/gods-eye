import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { connectShipFeed, getShipColor } from '../feeds/ShipFeed';

interface UseShipFeedOptions {
  viewer: Cesium.Viewer | null;
  active: boolean;
  onCountUpdate: (count: number) => void;
}

export function useShipFeed({ viewer, active, onCountUpdate }: UseShipFeedOptions) {
  const shipRef = useRef<Map<string, Cesium.Entity>>(new Map());

  useEffect(() => {
    if (!viewer || !active) {
      shipRef.current.forEach(e => viewer?.entities.remove(e));
      shipRef.current.clear();
      onCountUpdate(0);
      return;
    }

    const v = viewer;

    // Use a wide bounding box for initial connection
    const rect = v.camera.computeViewRectangle();
    const bounds = rect ? {
      south: Math.max(-90, Cesium.Math.toDegrees(rect.south)),
      west: Math.max(-180, Cesium.Math.toDegrees(rect.west)),
      north: Math.min(90, Cesium.Math.toDegrees(rect.north)),
      east: Math.min(180, Cesium.Math.toDegrees(rect.east)),
    } : { south: -60, west: -180, north: 60, east: 180 };

    const disconnect = connectShipFeed(bounds, (ships) => {
      const currentIds = new Set<string>();

      ships.forEach((ship, mmsi) => {
        currentIds.add(mmsi);
        const pos = Cesium.Cartesian3.fromDegrees(ship.longitude, ship.latitude, 0);
        const existing = shipRef.current.get(mmsi);
        const color = Cesium.Color.fromCssColorString(getShipColor(ship.shipType));

        if (existing) {
          existing.position = new Cesium.ConstantPositionProperty(pos);
        } else {
          const entity = v.entities.add({
            position: pos,
            point: {
              pixelSize: 5,
              color: color,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
            },
            label: {
              text: ship.name,
              font: '9px Share Tech Mono',
              fillColor: color,
              pixelOffset: new Cesium.Cartesian2(8, 0),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 500_000),
              style: Cesium.LabelStyle.FILL,
            },
            properties: { feedType: 'ship', data: ship },
          });
          shipRef.current.set(mmsi, entity);
        }
      });

      // Remove ships no longer in feed
      for (const [id, e] of shipRef.current) {
        if (!currentIds.has(id)) { v.entities.remove(e); shipRef.current.delete(id); }
      }

      onCountUpdate(currentIds.size);
    });

    return () => {
      disconnect();
      shipRef.current.forEach(e => v.entities.remove(e));
      shipRef.current.clear();
    };
  }, [viewer, active]);

  return { shipEntities: shipRef };
}
