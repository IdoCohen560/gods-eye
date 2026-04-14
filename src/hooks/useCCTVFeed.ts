import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { loadCameras } from '../feeds/CCTVFeed';

interface UseCCTVFeedOptions {
  viewer: Cesium.Viewer | null;
  active: boolean;
  onCountUpdate: (count: number) => void;
}

function createCameraIcon(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 20; c.height = 20;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ff6b00'; ctx.fillRect(3,5,10,10);
  ctx.beginPath(); ctx.moveTo(13,7); ctx.lineTo(18,4); ctx.lineTo(18,16); ctx.lineTo(13,13); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(8,10,3,0,Math.PI*2); ctx.fill();
  return c;
}

export function useCCTVFeed({ viewer, active, onCountUpdate }: UseCCTVFeedOptions) {
  const cameraRef = useRef<Map<string, Cesium.Entity>>(new Map());

  useEffect(() => {
    if (!viewer || !active) {
      cameraRef.current.forEach(e => viewer?.entities.remove(e));
      cameraRef.current.clear();
      if (!active) onCountUpdate(0);
      return;
    }

    const v = viewer;
    const cameras = loadCameras();
    for (const cam of cameras) {
      const entity = v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 50),
        billboard: {
          image: createCameraIcon(), width: 20, height: 20,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 200_000),
        },
        label: {
          text: cam.name, font: '9px Share Tech Mono',
          fillColor: Cesium.Color.ORANGE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 50_000),
          style: Cesium.LabelStyle.FILL,
        },
        properties: { feedType: 'camera', data: cam },
      });
      cameraRef.current.set(cam.id, entity);
    }
    onCountUpdate(cameras.length);

    return () => { cameraRef.current.forEach(e => v.entities.remove(e)); cameraRef.current.clear(); };
  }, [viewer, active]);

  return { cameraEntities: cameraRef };
}
