import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { GOOGLE_MAPS_API_KEY } from '../config/constants';
import { applyShader, removeShader } from '../shaders/ShaderManager';
import { createGIBSLayer } from '../layers/GIBSLayerManager';
import { GIBS_LAYERS } from '../config/gibs-layers';
import { useAircraftFeed } from '../hooks/useAircraftFeed';
import { useSatelliteFeed } from '../hooks/useSatelliteFeed';
import { useCCTVFeed } from '../hooks/useCCTVFeed';
import { useEarthquakeFeed } from '../hooks/useEarthquakeFeed';
import { useShipFeed } from '../hooks/useShipFeed';
import { useConflictFeed } from '../hooks/useConflictFeed';
import { useFireFeed } from '../hooks/useFireFeed';
import { useTrafficFeed } from '../hooks/useTrafficFeed';
import { reportFeedStatus, reportToast } from '../hooks/useFeedStatus';
import DetectionOverlay from './DetectionOverlay';
import type { Camera } from '../feeds/CCTVFeed';
import type { AircraftState } from '../feeds/AircraftFeed';
import type { ShaderMode, ViewState, FeedCounts } from '../App';

interface Props {
  onReady: (viewer: Cesium.Viewer) => void;
  shaderMode: ShaderMode;
  activeLayers: Record<string, boolean>;
  onViewStateChange: (state: ViewState) => void;
  onFeedCountUpdate: (key: keyof FeedCounts, count: number) => void;
}

export default function CesiumViewer({ onReady, shaderMode, activeLayers, onViewStateChange, onFeedCountUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const prevShaderRef = useRef<ShaderMode>('normal');
  const gibsLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const gibsIndividualRef = useRef<Map<string, Cesium.ImageryLayer>>(new Map());

  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<AircraftState | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [detectionEntities, setDetectionEntities] = useState<any[]>([]);

  // ======= FEED HOOKS =======
  const { aircraftEntities } = useAircraftFeed({
    viewer, active: activeLayers.aircraft,
    onCountUpdate: (c) => onFeedCountUpdate('aircraft', c),
  });
  const { satelliteEntities } = useSatelliteFeed({
    viewer, active: activeLayers.satellites,
    onCountUpdate: (c) => onFeedCountUpdate('satellites', c),
  });
  const { cameraEntities } = useCCTVFeed({
    viewer, active: activeLayers.cctv,
    onCountUpdate: (c) => onFeedCountUpdate('cameras', c),
  });
  const { earthquakeEntities } = useEarthquakeFeed({
    viewer, active: activeLayers.earthquakes,
    onCountUpdate: (c) => onFeedCountUpdate('earthquakes', c),
  });
  const { shipEntities } = useShipFeed({
    viewer, active: activeLayers.ships,
    onCountUpdate: (c) => onFeedCountUpdate('ships', c),
  });
  const { conflictEntities } = useConflictFeed({
    viewer, active: activeLayers.conflicts,
    onCountUpdate: (c) => onFeedCountUpdate('conflicts', c),
  });
  const { fireEntities } = useFireFeed({
    viewer, active: activeLayers.fires,
    onCountUpdate: (c) => onFeedCountUpdate('fires', c),
  });
  useTrafficFeed({
    viewer, active: activeLayers.traffic,
    onCountUpdate: () => {},
  });

  // ======= INIT VIEWER =======
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const v = new Cesium.Viewer(containerRef.current, {
      timeline: false, animation: false, baseLayerPicker: false,
      geocoder: false, homeButton: false, navigationHelpButton: false,
      sceneModePicker: false, fullscreenButton: false,
      selectionIndicator: true, infoBox: false,
      requestRenderMode: true, maximumRenderTimeChange: Infinity,
    });

    Cesium.CesiumTerrainProvider.fromIonAssetId(1).then(terrain => {
      v.scene.terrainProvider = terrain;
    }).catch(e => console.warn('Cesium Ion terrain unavailable:', e));

    v.clock.shouldAnimate = false;

    if (GOOGLE_MAPS_API_KEY) {
      Cesium.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_MAPS_API_KEY}`,
        { showCreditsOnScreen: true, maximumScreenSpaceError: 16 }
      ).then(tileset => {
        v.scene.primitives.add(tileset);
        reportFeedStatus('google3d', 'online');
      }).catch(e => {
        console.error('Google 3D Tiles failed:', e);
        reportToast('Google 3D Tiles failed to load', 'warning', 'google3d');
      });
    }

    v.scene.globe.enableLighting = true;

    Cesium.createOsmBuildingsAsync().then(buildings => {
      buildings.showOutline = false;
      v.scene.primitives.add(buildings);
    }).catch(e => console.warn('OSM Buildings unavailable:', e));

    v.camera.changed.addEventListener(() => {
      const c = v.camera.positionCartographic;
      onViewStateChange({
        lat: Cesium.Math.toDegrees(c.latitude),
        lon: Cesium.Math.toDegrees(c.longitude),
        alt: c.height,
        heading: Cesium.Math.toDegrees(v.camera.heading),
      });
    });

    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      const picked = v.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id) {
        const entity = picked.id as Cesium.Entity;
        const props = entity.properties;
        const t = v.clock.currentTime;
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

    const handleKeyControls = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const camera = v.camera;
      const alt = camera.positionCartographic.height;
      const lat = Cesium.Math.toDegrees(camera.positionCartographic.latitude);
      const lon = Cesium.Math.toDegrees(camera.positionCartographic.longitude);
      const panDeg = alt / 1_000_000;

      switch (e.key) {
        case '=': case '+': camera.zoomIn(alt * 0.3); break;
        case '-': case '_': camera.zoomOut(alt * 0.3); break;
        case 'w': case 'W': camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, Math.min(89, lat + panDeg), alt), duration: 0.3 }); break;
        case 's': case 'S': camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, Math.max(-89, lat - panDeg), alt), duration: 0.3 }); break;
        case 'a': case 'A': camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon - panDeg, lat, alt), duration: 0.3 }); break;
        case 'd': case 'D': camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon + panDeg, lat, alt), duration: 0.3 }); break;
      }
    };
    window.addEventListener('keydown', handleKeyControls);

    viewerRef.current = v;
    setViewer(v);
    onReady(v);

    return () => {
      window.removeEventListener('keydown', handleKeyControls);
      handler.destroy();
      v.destroy();
      viewerRef.current = null;
    };
  }, []);

  // ======= SHADERS =======
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    removeShader(v, prevShaderRef.current);
    applyShader(v, shaderMode);
    prevShaderRef.current = shaderMode;
  }, [shaderMode]);

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

  // ======= DETECTION OVERLAY =======
  useEffect(() => {
    if (!activeLayers.boundingBoxes) { setDetectionEntities([]); return; }

    const interval = setInterval(() => {
      const entities: any[] = [];
      const now = Cesium.JulianDate.now();

      aircraftEntities.current.forEach((e, id) => {
        if (e.position) {
          const pos = e.position.getValue(now);
          if (pos) {
            const props = e.properties?.data?.getValue(now);
            entities.push({
              id: `ac-${id}`, type: 'aircraft',
              label: `${props?.callsign?.trim() || id} ALT:${(props?.baro_altitude || 0).toFixed(0)}m`,
              position: pos,
            });
          }
        }
      });

      satelliteEntities.current.forEach((e, name) => {
        if (e.position) {
          const pos = e.position.getValue(now);
          if (pos) entities.push({ id: `sat-${name}`, type: 'satellite', label: name, position: pos });
        }
      });

      earthquakeEntities.current.forEach((e, id) => {
        if (e.position) {
          const pos = e.position.getValue(now);
          if (pos) {
            const props = e.properties?.data?.getValue(now);
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
        <CameraPanel camera={selectedCamera} onClose={() => setSelectedCamera(null)} />
      )}
    </>
  );
}

function CameraPanel({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const [imgSrc, setImgSrc] = useState(camera.url);
  const [error, setError] = useState(false);

  useEffect(() => {
    setImgSrc(`${camera.url}?t=${Date.now()}`);
    setError(false);
    const interval = setInterval(() => { setImgSrc(`${camera.url}?t=${Date.now()}`); }, 5000);
    return () => clearInterval(interval);
  }, [camera.url]);

  return (
    <div className="video-panel">
      <div className="video-header">
        <span style={{ color: 'var(--accent-green)', fontSize: 11 }}>{camera.name} — {camera.city}</span>
        <button className="close-btn" onClick={onClose}>X</button>
      </div>
      {error ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
          FEED UNAVAILABLE — CORS BLOCKED OR OFFLINE
        </div>
      ) : (
        <img src={imgSrc} alt={camera.name} style={{ width: '100%', display: 'block' }} onError={() => setError(true)} />
      )}
      <div style={{ padding: '4px 8px', fontSize: 9, color: 'var(--text-dim)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
        <span>LIVE — REFRESH 5s</span>
        <span>{camera.type.toUpperCase()}</span>
      </div>
    </div>
  );
}
