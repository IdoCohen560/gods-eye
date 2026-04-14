import { useState, useCallback, useEffect } from 'react';
import CesiumViewer from './components/CesiumViewer';
import Sidebar from './components/Sidebar';
import HUD from './components/HUD';
import ShaderSelector from './components/ShaderSelector';
import CommandBar from './components/CommandBar';
import BootSequence from './components/BootSequence';
import ToastNotification from './components/ToastNotification';
import type { Viewer } from 'cesium';

export type ShaderMode = 'normal' | 'nvg' | 'flir' | 'crt' | 'cel' | 'classified' | 'bw' | 'surveillance';

export interface ViewState {
  lat: number;
  lon: number;
  alt: number;
  heading: number;
}

export interface FeedCounts {
  aircraft: number;
  satellites: number;
  cameras: number;
  ships: number;
  conflicts: number;
  earthquakes: number;
  fires: number;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [shaderMode, setShaderMode] = useState<ShaderMode>('normal');
  const [viewState, setViewState] = useState<ViewState>({ lat: 0, lon: 0, alt: 10_000_000, heading: 0 });
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>({
    aircraft: true,
    satellites: false,
    cctv: true,
    traffic: false,
    ships: false,
    conflicts: false,
    earthquakes: false,
    fires: false,
    boundingBoxes: true,
    gibs: false,
    gibs_viirs_nightlights: false,
    gibs_firms_fire: false,
    gibs_aerosol: false,
    gibs_sst: false,
  });
  const [feedCounts, setFeedCounts] = useState<FeedCounts>({
    aircraft: 0, satellites: 0, cameras: 0, ships: 0, conflicts: 0, earthquakes: 0, fires: 0,
  });

  const handleViewerReady = useCallback((v: Viewer) => {
    setViewer(v);
  }, []);

  const toggleLayer = useCallback((layer: string) => {
    setActiveLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  const updateFeedCount = useCallback((key: keyof FeedCounts, count: number) => {
    setFeedCounts(prev => ({ ...prev, [key]: count }));
  }, []);

  if (booting) {
    return <BootSequence onComplete={() => setBooting(false)} />;
  }

  return (
    <div className="app">
      <CommandBar viewer={viewer} />
      <ToastNotification />
      <div className="main-container">
        <Sidebar activeLayers={activeLayers} toggleLayer={toggleLayer} />
        <div className="viewer-container">
          <CesiumViewer
            onReady={handleViewerReady}
            shaderMode={shaderMode}
            activeLayers={activeLayers}
            onViewStateChange={setViewState}
            onFeedCountUpdate={updateFeedCount}
          />
          <HUD viewState={viewState} feedCounts={feedCounts} shaderMode={shaderMode} />
          <ShaderSelector current={shaderMode} onChange={setShaderMode} />
        </div>
      </div>
    </div>
  );
}
