import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { fetchRoads } from '../feeds/TrafficFlow';

interface UseTrafficFeedOptions {
  viewer: Cesium.Viewer | null;
  active: boolean;
  onCountUpdate: (count: number) => void;
}

function interpolateRoad(coords: [number, number][], t: number): [number, number] {
  if (coords.length < 2) return coords[0];
  const total = coords.length - 1;
  const seg = Math.min(Math.floor(t * total), total - 1);
  const frac = t * total - seg;
  return [
    coords[seg][0] + (coords[seg + 1][0] - coords[seg][0]) * frac,
    coords[seg][1] + (coords[seg + 1][1] - coords[seg][1]) * frac,
  ];
}

export function useTrafficFeed({ viewer, active, onCountUpdate }: UseTrafficFeedOptions) {
  const trafficPrimRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const trafficAnimRef = useRef<number>(0);

  useEffect(() => {
    if (!viewer || !active) {
      if (trafficPrimRef.current) { viewer?.scene.primitives.remove(trafficPrimRef.current); trafficPrimRef.current = null; }
      if (trafficAnimRef.current) { cancelAnimationFrame(trafficAnimRef.current); trafficAnimRef.current = 0; }
      return;
    }

    let cancelled = false;
    let particles: { progress: number; speed: number; coords: [number, number][] }[] = [];
    const v = viewer;
    const pc = new Cesium.PointPrimitiveCollection();
    v.scene.primitives.add(pc);
    trafficPrimRef.current = pc;

    const load = async () => {
      try {
        const rect = v.camera.computeViewRectangle();
        if (!rect || v.camera.positionCartographic.height > 50_000) return;
        const bounds = {
          south: Cesium.Math.toDegrees(rect.south), west: Cesium.Math.toDegrees(rect.west),
          north: Cesium.Math.toDegrees(rect.north), east: Cesium.Math.toDegrees(rect.east),
        };
        const roads = await fetchRoads(bounds);
        if (cancelled) return;
        particles = []; pc.removeAll();
        for (const road of roads) {
          if (road.coords.length < 2) continue;
          const count = road.type === 'motorway' ? 8 : road.type === 'trunk' ? 5 : 3;
          const speed = road.type === 'motorway' ? 0.003 : road.type === 'trunk' ? 0.002 : 0.001;
          for (let i = 0; i < count; i++) {
            const progress = Math.random();
            const pos = interpolateRoad(road.coords, progress);
            pc.add({
              position: Cesium.Cartesian3.fromDegrees(pos[0], pos[1], 5), pixelSize: 3,
              color: road.type === 'motorway' ? Cesium.Color.fromCssColorString('#00ff41') : Cesium.Color.YELLOW,
            });
            particles.push({ progress, speed, coords: road.coords });
          }
        }
      } catch (e) { console.error('Traffic error:', e); }
    };

    load();

    // Re-fetch when user zooms into city level
    let debounceTimer: ReturnType<typeof setTimeout>;
    const onCameraChange = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!cancelled && v.camera.positionCartographic.height < 50_000 && particles.length === 0) {
          load();
        }
      }, 1500);
    };
    v.camera.changed.addEventListener(onCameraChange);

    const animate = () => {
      if (cancelled) return;
      for (let i = 0; i < particles.length; i++) {
        particles[i].progress = (particles[i].progress + particles[i].speed) % 1;
        const pos = interpolateRoad(particles[i].coords, particles[i].progress);
        const pt = pc.get(i);
        if (pt) pt.position = Cesium.Cartesian3.fromDegrees(pos[0], pos[1], 5);
      }
      trafficAnimRef.current = requestAnimationFrame(animate);
    };
    setTimeout(() => { if (!cancelled) animate(); }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
      v.camera.changed.removeEventListener(onCameraChange);
      if (trafficAnimRef.current) cancelAnimationFrame(trafficAnimRef.current);
      if (trafficPrimRef.current) { v.scene.primitives.remove(trafficPrimRef.current); trafficPrimRef.current = null; }
    };
  }, [viewer, active]);
}
