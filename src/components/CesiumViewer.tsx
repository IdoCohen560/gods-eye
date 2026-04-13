import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { GOOGLE_MAPS_API_KEY, AIRCRAFT_POLL_INTERVAL, SATELLITE_UPDATE_INTERVAL, FIRMS_MAP_KEY, ACLED_EMAIL, ACLED_PASSWORD } from '../config/constants';
import { applyShader, removeShader } from '../shaders/ShaderManager';
import { fetchAircraft, type AircraftState } from '../feeds/AircraftFeed';
import { fetchSatellites, propagateAll, type SatelliteRecord, type SatellitePosition } from '../feeds/SatelliteFeed';
import { loadCameras, type Camera } from '../feeds/CCTVFeed';
import { fetchRoads } from '../feeds/TrafficFlow';
import { fetchEarthquakes, type Earthquake } from '../feeds/EarthquakeFeed';
import { fetchFIRMS, type FireHotspot } from '../feeds/FIRMSFeed';
import { fetchConflicts, type ConflictEvent } from '../feeds/ConflictFeed';
import { createGIBSLayer } from '../layers/GIBSLayerManager';
import { GIBS_LAYERS } from '../config/gibs-layers';
import DetectionOverlay from './DetectionOverlay';
import type { ShaderMode, ViewState, FeedCounts } from '../App';

interface Props {
  onReady: (viewer: Cesium.Viewer) => void;
  shaderMode: ShaderMode;
  activeLayers: Record<string, boolean>;
  onViewStateChange: (state: ViewState) => void;
  onFeedCountUpdate: (key: keyof FeedCounts, count: number) => void;
}

// Satellite category colors
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

export default function CesiumViewer({ onReady, shaderMode, activeLayers, onViewStateChange, onFeedCountUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const prevShaderRef = useRef<ShaderMode>('normal');

  // Entity refs
  const aircraftRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const satelliteRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const orbitRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const cameraRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const earthquakeRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const trafficPrimRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const trafficAnimRef = useRef<number>(0);
  const gibsLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const gibsIndividualRef = useRef<Map<string, Cesium.ImageryLayer>>(new Map());
  const fireRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const conflictRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const satDataRef = useRef<SatelliteRecord[]>([]);

  const [selectedAircraft, setSelectedAircraft] = useState<AircraftState | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [detectionEntities, setDetectionEntities] = useState<any[]>([]);

  // ======= INIT VIEWER =======
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain: Cesium.Terrain.fromWorldTerrain(),
      timeline: true,
      animation: true,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: true,
      fullscreenButton: false,
      selectionIndicator: true,
      infoBox: false,
    });

    if (GOOGLE_MAPS_API_KEY) {
      Cesium.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_MAPS_API_KEY}`,
        { showCreditsOnScreen: true }
      ).then(ts => viewer.scene.primitives.add(ts))
       .catch(e => console.warn('Google 3D Tiles unavailable:', e));
    }

    viewer.scene.globe.enableLighting = true;

    viewer.camera.changed.addEventListener(() => {
      const c = viewer.camera.positionCartographic;
      onViewStateChange({
        lat: Cesium.Math.toDegrees(c.latitude),
        lon: Cesium.Math.toDegrees(c.longitude),
        alt: c.height,
        heading: Cesium.Math.toDegrees(viewer.camera.heading),
      });
    });

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      const picked = viewer.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id) {
        const entity = picked.id as Cesium.Entity;
        const props = entity.properties;
        const t = viewer.clock.currentTime;
        if (props?.feedType?.getValue(t) === 'aircraft') {
          setSelectedAircraft(props.data?.getValue(t));
          setSelectedCamera(null);
        } else if (props?.feedType?.getValue(t) === 'camera') {
          setSelectedCamera(props.data?.getValue(t));
          setSelectedAircraft(null);
        }
      } else {
        setSelectedAircraft(null);
        setSelectedCamera(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewerRef.current = viewer;
    onReady(viewer);

    return () => { handler.destroy(); viewer.destroy(); viewerRef.current = null; };
  }, []);

  // ======= SHADERS =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    removeShader(v, prevShaderRef.current);
    applyShader(v, shaderMode);
    prevShaderRef.current = shaderMode;
  }, [shaderMode]);

  // ======= AIRCRAFT =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !activeLayers.aircraft) {
      aircraftRef.current.forEach(e => viewerRef.current?.entities.remove(e));
      aircraftRef.current.clear();
      if (!activeLayers.aircraft) onFeedCountUpdate('aircraft', 0);
      return;
    }

    let cancelled = false;
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
        if (bounds.lamax - bounds.lamin > 30) return;

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
        onFeedCountUpdate('aircraft', ids.size);
      } catch (err) { console.error('Aircraft error:', err); }
    };

    poll();
    const interval = setInterval(poll, AIRCRAFT_POLL_INTERVAL);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeLayers.aircraft]);

  // ======= SATELLITES (with orbit lines) =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !activeLayers.satellites) {
      satelliteRef.current.forEach(e => viewerRef.current?.entities.remove(e));
      satelliteRef.current.clear();
      orbitRef.current.forEach(e => viewerRef.current?.entities.remove(e));
      orbitRef.current.clear();
      if (!activeLayers.satellites) onFeedCountUpdate('satellites', 0);
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
          if (!sat.position) continue;
          count++;
          const color = SAT_COLORS[sat.category] || Cesium.Color.CYAN;
          const size = SAT_SIZES[sat.category] || 5;
          const pos = Cesium.Cartesian3.fromDegrees(
            sat.position.longitude, sat.position.latitude, sat.position.altitude * 1000
          );

          // Satellite point
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

          // Orbit path line (skip starlink for performance)
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

        onFeedCountUpdate('satellites', count);
      } catch (err) { console.error('Satellite error:', err); }
    };

    init();

    // Update satellite positions
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
      satelliteRef.current.forEach(e => v.entities.remove(e));
      satelliteRef.current.clear();
      orbitRef.current.forEach(e => v.entities.remove(e));
      orbitRef.current.clear();
    };
  }, [activeLayers.satellites]);

  // ======= CCTV =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !activeLayers.cctv) {
      cameraRef.current.forEach(e => viewerRef.current?.entities.remove(e));
      cameraRef.current.clear();
      if (!activeLayers.cctv) onFeedCountUpdate('cameras', 0);
      return;
    }

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
    onFeedCountUpdate('cameras', cameras.length);

    return () => { cameraRef.current.forEach(e => v.entities.remove(e)); cameraRef.current.clear(); };
  }, [activeLayers.cctv]);

  // ======= EARTHQUAKES (USGS) =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !activeLayers.earthquakes) {
      earthquakeRef.current.forEach(e => viewerRef.current?.entities.remove(e));
      earthquakeRef.current.clear();
      if (!activeLayers.earthquakes) onFeedCountUpdate('earthquakes', 0);
      return;
    }

    let cancelled = false;

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

        onFeedCountUpdate('earthquakes', quakes.length);
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
  }, [activeLayers.earthquakes]);

  // ======= CONFLICTS (ACLED) =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !activeLayers.conflicts || !ACLED_EMAIL || !ACLED_PASSWORD) {
      conflictRef.current.forEach(e => viewerRef.current?.entities.remove(e));
      conflictRef.current.clear();
      if (!activeLayers.conflicts) onFeedCountUpdate('conflicts', 0);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const events = await fetchConflicts(ACLED_EMAIL, ACLED_PASSWORD);
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

          const size = Math.max(6, Math.min(16, 6 + ev.fatalities * 2));

          const entity = v.entities.add({
            position: Cesium.Cartesian3.fromDegrees(ev.longitude, ev.latitude, 0),
            point: {
              pixelSize: size,
              color: Cesium.Color.fromAlpha(color, 0.8),
              outlineColor: color,
              outlineWidth: 2,
            },
            ellipse: {
              semiMajorAxis: Math.max(5000, ev.fatalities * 3000),
              semiMinorAxis: Math.max(5000, ev.fatalities * 3000),
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

        onFeedCountUpdate('conflicts', events.length);
      } catch (err) { console.error('Conflict error:', err); }
    };

    load();
    return () => {
      cancelled = true;
      conflictRef.current.forEach(e => v.entities.remove(e));
      conflictRef.current.clear();
    };
  }, [activeLayers.conflicts]);

  // ======= FIRMS FIRE/THERMAL =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !activeLayers.fires || !FIRMS_MAP_KEY) {
      fireRef.current.forEach(e => viewerRef.current?.entities.remove(e));
      fireRef.current.clear();
      if (!activeLayers.fires) onFeedCountUpdate('fires', 0);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const hotspots = await fetchFIRMS(FIRMS_MAP_KEY);
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

        onFeedCountUpdate('fires', hotspots.length);
      } catch (err) { console.error('FIRMS error:', err); }
    };

    load();
    return () => {
      cancelled = true;
      fireRef.current.forEach(e => v.entities.remove(e));
      fireRef.current.clear();
    };
  }, [activeLayers.fires]);

  // ======= TRAFFIC FLOW =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !activeLayers.traffic) {
      if (trafficPrimRef.current) { v?.scene.primitives.remove(trafficPrimRef.current); trafficPrimRef.current = null; }
      if (trafficAnimRef.current) { cancelAnimationFrame(trafficAnimRef.current); trafficAnimRef.current = 0; }
      return;
    }

    let cancelled = false;
    let particles: { progress: number; speed: number; coords: [number, number][] }[] = [];
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
      if (trafficAnimRef.current) cancelAnimationFrame(trafficAnimRef.current);
      if (trafficPrimRef.current) { v.scene.primitives.remove(trafficPrimRef.current); trafficPrimRef.current = null; }
    };
  }, [activeLayers.traffic]);

  // ======= GIBS LAYERS =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (gibsLayerRef.current) { v.imageryLayers.remove(gibsLayerRef.current); gibsLayerRef.current = null; }
    if (activeLayers.gibs) {
      const provider = createGIBSLayer(GIBS_LAYERS[0]);
      const layer = v.imageryLayers.addImageryProvider(provider);
      layer.alpha = 0.7;
      gibsLayerRef.current = layer;
    }
  }, [activeLayers.gibs]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    for (const cfg of GIBS_LAYERS) {
      const key = `gibs_${cfg.id}`;
      const isActive = activeLayers[key];
      const existing = gibsIndividualRef.current.get(cfg.id);
      if (isActive && !existing) {
        const provider = createGIBSLayer(cfg);
        const layer = v.imageryLayers.addImageryProvider(provider);
        layer.alpha = 0.7;
        gibsIndividualRef.current.set(cfg.id, layer);
      } else if (!isActive && existing) {
        v.imageryLayers.remove(existing);
        gibsIndividualRef.current.delete(cfg.id);
      }
    }
  }, [activeLayers.gibs_viirs_nightlights, activeLayers.gibs_firms_fire, activeLayers.gibs_aerosol, activeLayers.gibs_sst]);

  // ======= DETECTION OVERLAY DATA =======
  useEffect(() => {
    if (!activeLayers.boundingBoxes) { setDetectionEntities([]); return; }

    const interval = setInterval(() => {
      const entities: any[] = [];

      aircraftRef.current.forEach((e, id) => {
        if (e.position) {
          const pos = e.position.getValue(Cesium.JulianDate.now());
          if (pos) {
            const props = e.properties?.data?.getValue(Cesium.JulianDate.now());
            entities.push({
              id: `ac-${id}`, type: 'aircraft',
              label: `${props?.callsign?.trim() || id} ALT:${(props?.baro_altitude || 0).toFixed(0)}m`,
              position: pos,
            });
          }
        }
      });

      satelliteRef.current.forEach((e, name) => {
        if (e.position) {
          const pos = e.position.getValue(Cesium.JulianDate.now());
          if (pos) entities.push({ id: `sat-${name}`, type: 'satellite', label: name, position: pos });
        }
      });

      earthquakeRef.current.forEach((e, id) => {
        if (e.position) {
          const pos = e.position.getValue(Cesium.JulianDate.now());
          if (pos) {
            const props = e.properties?.data?.getValue(Cesium.JulianDate.now());
            entities.push({
              id: `eq-${id}`, type: 'earthquake',
              label: `M${props?.magnitude?.toFixed(1) || '?'}`,
              position: pos,
            });
          }
        }
      });

      setDetectionEntities(entities);
    }, 500);

    return () => clearInterval(interval);
  }, [activeLayers.boundingBoxes, activeLayers.aircraft, activeLayers.satellites, activeLayers.earthquakes]);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <DetectionOverlay
        viewer={viewerRef.current}
        entities={detectionEntities}
        enabled={activeLayers.boundingBoxes ?? false}
      />

      {selectedAircraft && (
        <div className="info-panel">
          <button className="close-btn" onClick={() => setSelectedAircraft(null)}>X</button>
          <h4>AIRCRAFT</h4>
          <div className="row"><span className="label">CALLSIGN</span><span>{selectedAircraft.callsign?.trim() || 'N/A'}</span></div>
          <div className="row"><span className="label">ICAO24</span><span>{selectedAircraft.icao24}</span></div>
          <div className="row"><span className="label">ORIGIN</span><span>{selectedAircraft.origin_country}</span></div>
          <div className="row"><span className="label">ALTITUDE</span><span>{selectedAircraft.baro_altitude?.toFixed(0) || '?'} m</span></div>
          <div className="row"><span className="label">VELOCITY</span><span>{selectedAircraft.velocity?.toFixed(0) || '?'} m/s</span></div>
          <div className="row"><span className="label">HEADING</span><span>{selectedAircraft.true_track?.toFixed(1) || '?'}°</span></div>
          <div className="row"><span className="label">VERT RATE</span><span>{selectedAircraft.vertical_rate?.toFixed(1) || '?'} m/s</span></div>
        </div>
      )}
      {selectedCamera && (
        <div className="video-panel">
          <div className="video-header">
            <span style={{ color: 'var(--accent-green)', fontSize: 11 }}>{selectedCamera.name}</span>
            <button className="close-btn" onClick={() => setSelectedCamera(null)}>X</button>
          </div>
          <img src={selectedCamera.url} alt={selectedCamera.name} style={{ width: '100%' }}
            onError={e => { (e.target as HTMLImageElement).alt = 'Feed unavailable'; }} />
        </div>
      )}
    </>
  );
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

function createAircraftIcon(color: Cesium.Color): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgba(${color.red*255},${color.green*255},${color.blue*255},1)`;
  ctx.beginPath(); ctx.moveTo(8,0); ctx.lineTo(14,12); ctx.lineTo(8,9); ctx.lineTo(2,12); ctx.closePath(); ctx.fill();
  return c;
}

function createCameraIcon(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 20; c.height = 20;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ff6b00'; ctx.fillRect(3,5,10,10);
  ctx.beginPath(); ctx.moveTo(13,7); ctx.lineTo(18,4); ctx.lineTo(18,16); ctx.lineTo(13,13); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(8,10,3,0,Math.PI*2); ctx.fill();
  return c;
}
