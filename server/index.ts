import express from 'express';
import cors from 'cors';
import { aircraftRouter } from './routes/aircraft';
import { satelliteRouter } from './routes/satellites';
import { earthquakeRouter } from './routes/earthquakes';
import { conflictRouter } from './routes/conflicts';
import { firmsRouter } from './routes/firms';
import { trafficRouter } from './routes/traffic';
import { shipRouter } from './routes/ships';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

// Feed routes — each has its own TTL cache
app.use('/api/aircraft', aircraftRouter);
app.use('/api/satellites', satelliteRouter);
app.use('/api/earthquakes', earthquakeRouter);
app.use('/api/conflicts', conflictRouter);
app.use('/api/firms', firmsRouter);
app.use('/api/traffic', trafficRouter);
app.use('/api/ships', shipRouter);

app.listen(PORT, () => {
  console.log(`[GOD'S EYE] Backend proxy running on port ${PORT}`);
  console.log(`[GOD'S EYE] API endpoints:`);
  console.log(`  GET /api/health`);
  console.log(`  GET /api/aircraft?lamin=&lomin=&lamax=&lomax=`);
  console.log(`  GET /api/satellites?group=stations`);
  console.log(`  GET /api/earthquakes`);
  console.log(`  GET /api/conflicts`);
  console.log(`  GET /api/firms?coords=world`);
  console.log(`  GET /api/traffic?data=<overpass_query>`);
  console.log(`  WS  /api/ships (WebSocket relay)`);
});
