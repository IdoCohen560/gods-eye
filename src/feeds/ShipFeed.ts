import { AISSTREAM_API_KEY, SHIPS_API, IS_EXPRESS_BACKEND } from '../config/constants';

export interface Ship {
  mmsi: string;
  name: string;
  latitude: number;
  longitude: number;
  speedOverGround: number;
  courseOverGround: number;
  shipType: number;
}

export function getShipCategory(type: number): string {
  if (type >= 60 && type <= 69) return 'passenger';
  if (type >= 70 && type <= 79) return 'cargo';
  if (type >= 80 && type <= 89) return 'tanker';
  if (type >= 35 && type <= 39) return 'military';
  return 'other';
}

export function getShipColor(type: number): string {
  const cat = getShipCategory(type);
  switch (cat) {
    case 'passenger': return '#ffffff';
    case 'cargo': return '#888888';
    case 'tanker': return '#ff6b00';
    case 'military': return '#ff2d2d';
    default: return '#4488ff';
  }
}

type ShipCallback = (ships: Map<string, Ship>) => void;

let ws: WebSocket | null = null;
let shipMap = new Map<string, Ship>();

/**
 * Express backend mode: poll /api/ships every 10s (server handles WebSocket)
 * Netlify mode: direct WebSocket from browser to AISStream
 */
export function connectShipFeed(
  bounds: { south: number; west: number; north: number; east: number },
  onUpdate: ShipCallback,
): () => void {
  // Express backend mode — server manages AIS WebSocket, we just poll HTTP
  if (IS_EXPRESS_BACKEND) {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(SHIPS_API);
        if (!res.ok) return;
        const data = await res.json();
        const map = new Map<string, Ship>();
        for (const ship of data.ships || []) {
          map.set(ship.mmsi, ship);
        }
        if (map.size > 0) onUpdate(map);
      } catch (e) {
        console.error('Ship poll error:', e);
      }
    };
    poll();
    const interval = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }

  // Direct WebSocket mode (Netlify / no backend)
  if (!AISSTREAM_API_KEY) return () => {};

  if (ws) { ws.close(); ws = null; }
  shipMap = new Map();

  ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  ws.onopen = () => {
    ws?.send(JSON.stringify({
      APIKey: AISSTREAM_API_KEY,
      BoundingBoxes: [[
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ]],
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.MessageType === 'PositionReport') {
        const pos = msg.Message?.PositionReport;
        const meta = msg.MetaData;
        if (!pos || !meta) return;

        const ship: Ship = {
          mmsi: String(meta.MMSI || ''),
          name: meta.ShipName?.trim() || `MMSI:${meta.MMSI}`,
          latitude: pos.Latitude,
          longitude: pos.Longitude,
          speedOverGround: pos.Sog || 0,
          courseOverGround: pos.Cog || 0,
          shipType: meta.ShipType || 0,
        };

        if (ship.latitude !== 0 && ship.longitude !== 0) {
          shipMap.set(ship.mmsi, ship);
        }

        if (shipMap.size % 50 === 0 || shipMap.size < 10) {
          onUpdate(new Map(shipMap));
        }
      }
    } catch { /* ignore parse errors */ }
  };

  ws.onerror = (err) => console.error('AISStream error:', err);
  ws.onclose = () => { ws = null; };

  const flushInterval = setInterval(() => {
    if (shipMap.size > 0) onUpdate(new Map(shipMap));
  }, 5000);

  return () => {
    clearInterval(flushInterval);
    if (ws) { ws.close(); ws = null; }
    shipMap.clear();
  };
}
