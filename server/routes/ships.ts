import { Router } from 'express';
import WebSocket from 'ws';

export const shipRouter = Router();

// Ship data cache — persists across HTTP requests
const shipCache = new Map<string, {
  mmsi: string; name: string;
  latitude: number; longitude: number;
  speedOverGround: number; courseOverGround: number; shipType: number;
}>();

let wsConnection: WebSocket | null = null;
let lastConnectTime = 0;

function connectAIS() {
  const apiKey = process.env.AISSTREAM_API_KEY || process.env.VITE_AISSTREAM_API_KEY;
  if (!apiKey) return;

  // Don't reconnect more than once per 30 seconds
  if (Date.now() - lastConnectTime < 30_000) return;
  lastConnectTime = Date.now();

  if (wsConnection) {
    try { wsConnection.close(); } catch {}
  }

  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
  wsConnection = ws;

  ws.on('open', () => {
    console.log('[AIS] WebSocket connected');
    ws.send(JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: [[[-90, -180], [90, 180]]], // Global
    }));
  });

  let msgCount = 0;
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.MessageType === 'PositionReport') {
        const pos = msg.Message?.PositionReport;
        const meta = msg.MetaData;
        if (!pos || !meta) return;
        if (pos.Latitude === 0 && pos.Longitude === 0) return;

        shipCache.set(String(meta.MMSI), {
          mmsi: String(meta.MMSI),
          name: meta.ShipName?.trim() || `MMSI:${meta.MMSI}`,
          latitude: pos.Latitude,
          longitude: pos.Longitude,
          speedOverGround: pos.Sog || 0,
          courseOverGround: pos.Cog || 0,
          shipType: meta.ShipType || 0,
        });
        msgCount++;
      }
    } catch {}
  });

  ws.on('close', () => {
    console.log(`[AIS] WebSocket closed after ${msgCount} messages, ${shipCache.size} ships cached`);
    wsConnection = null;
    // Auto-reconnect after 60s
    setTimeout(connectAIS, 60_000);
  });

  ws.on('error', (err) => {
    console.error('[AIS] WebSocket error:', err.message);
  });

  // Disconnect after 30s to avoid burning API quota, keep cached data
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      console.log(`[AIS] Burst complete: ${shipCache.size} ships cached`);
      ws.close();
    }
  }, 30_000);
}

// Start AIS connection on first load
connectAIS();

// HTTP endpoint returns cached ship data
shipRouter.get('/', (_req, res) => {
  // Reconnect if stale (>2 minutes since last connect)
  if (Date.now() - lastConnectTime > 120_000) {
    connectAIS();
  }

  const ships = Array.from(shipCache.values());
  res.json({
    count: ships.length,
    ships,
    lastConnect: lastConnectTime,
    wsActive: wsConnection?.readyState === WebSocket.OPEN,
  });
});
