import * as Cesium from 'cesium';

export interface GIBSLayerConfig {
  id: string;
  name: string;
  layer: string;
  tileMatrixSetID: string;
  format: string;
  maxLevel: number;
}

export function createGIBSLayer(config: GIBSLayerConfig): Cesium.WebMapTileServiceImageryProvider {
  // Use yesterday's date (today's imagery may not be processed yet)
  const yesterday = new Date(Date.now() - 86_400_000);
  const dateStr = yesterday.toISOString().slice(0, 10);

  // GIBS RESTful tile URL template (not KVP)
  // Format: https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/{date}/{tileMatrixSet}/{z}/{y}/{x}.{ext}
  const ext = config.format === 'image/jpeg' ? 'jpg' : 'png';

  return new Cesium.WebMapTileServiceImageryProvider({
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${config.layer}/default/${dateStr}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.${ext}`,
    layer: config.layer,
    tileMatrixSetID: config.tileMatrixSetID,
    format: config.format,
    style: 'default',
    maximumLevel: config.maxLevel,
    tilingScheme: new Cesium.GeographicTilingScheme(),
  });
}
