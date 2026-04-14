import { useState } from 'react';
import FeedStatusBar from './FeedStatusBar';

interface Props {
  activeLayers: Record<string, boolean>;
  toggleLayer: (layer: string) => void;
}

interface LayerGroup {
  title: string;
  layers: { key: string; label: string; live?: boolean }[];
}

const LAYER_GROUPS: LayerGroup[] = [
  {
    title: 'LIVE FEEDS',
    layers: [
      { key: 'aircraft', label: 'Aircraft (OpenSky)', live: true },
      { key: 'satellites', label: 'Satellites (CelesTrak)', live: true },
      { key: 'cctv', label: 'CCTV Cameras', live: true },
      { key: 'traffic', label: 'Traffic Flow (OSM)' },
      { key: 'ships', label: 'Ships (AISStream)', live: true },
    ],
  },
  {
    title: 'THREAT INTELLIGENCE',
    layers: [
      { key: 'conflicts', label: 'Conflicts & Battles (ACLED)' },
      { key: 'earthquakes', label: 'Earthquakes (USGS)', live: true },
      { key: 'fires', label: 'Fire/Thermal (FIRMS)' },
    ],
  },
  {
    title: 'NASA IMAGERY',
    layers: [
      { key: 'gibs', label: 'MODIS True Color' },
      { key: 'gibs_viirs_nightlights', label: 'VIIRS Night Lights' },
      { key: 'gibs_firms_fire', label: 'Fire Overlay' },
      { key: 'gibs_aerosol', label: 'Aerosol Depth' },
      { key: 'gibs_sst', label: 'Sea Surface Temp' },
    ],
  },
  {
    title: 'DETECTION',
    layers: [
      { key: 'boundingBoxes', label: 'Bounding Boxes' },
    ],
  },
];

export default function Sidebar({ activeLayers, toggleLayer }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (title: string) => {
    setCollapsed(prev => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <div className="sidebar">
      {LAYER_GROUPS.map(group => (
        <div key={group.title}>
          <h3 onClick={() => toggle(group.title)} style={{ cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontSize: 8, marginRight: 6 }}>
              {collapsed[group.title] ? '▶' : '▼'}
            </span>
            {group.title}
          </h3>
          {!collapsed[group.title] && group.layers.map(layer => (
            <label key={layer.key}>
              <input
                type="checkbox"
                checked={activeLayers[layer.key] ?? false}
                onChange={() => toggleLayer(layer.key)}
              />
              {layer.label}
              {layer.live && (
                <span style={{
                  marginLeft: 'auto',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: activeLayers[layer.key] ? 'var(--accent-green)' : 'var(--text-dim)',
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
              )}
            </label>
          ))}
        </div>
      ))}

      <h3>SHORTCUTS</h3>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', padding: '0 8px', lineHeight: 1.8 }}>
        [1-8] Shader modes<br />
        [W/A/S/D] Move around<br />
        [+] Zoom in  [-] Zoom out<br />
        Click entity for details<br />
        Click camera for live feed
      </div>

      <FeedStatusBar />
    </div>
  );
}
