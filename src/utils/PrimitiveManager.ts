import * as Cesium from 'cesium';

/**
 * Describes an entity to be rendered via Cesium primitive collections.
 */
export interface PrimitiveEntity {
  id: string;
  position: Cesium.Cartesian3;
  color?: Cesium.Color;
  pixelSize?: number;
  label?: string;
  labelColor?: Cesium.Color;
  labelFont?: string;
  labelOffset?: Cesium.Cartesian2;
  image?: HTMLCanvasElement;
  imageWidth?: number;
  imageHeight?: number;
  rotation?: number;
  distanceDisplayCondition?: Cesium.DistanceDisplayCondition;
  labelDistanceDisplayCondition?: Cesium.DistanceDisplayCondition;
}

interface IndexEntry {
  pointIdx?: number;
  billboardIdx?: number;
  labelIdx?: number;
}

/**
 * High-performance wrapper around Cesium's PointPrimitiveCollection,
 * BillboardCollection, and LabelCollection. Bypasses the Entity API
 * to render 100K+ items at 60fps on the GPU.
 *
 * Uses a "mark and rebuild" strategy for removals since primitive
 * collection indices shift on remove.
 */
export class PrimitiveManager {
  private scene: Cesium.Scene;
  private points: Cesium.PointPrimitiveCollection;
  private billboards: Cesium.BillboardCollection;
  private labels: Cesium.LabelCollection;
  private indexMap = new Map<string, IndexEntry>();
  private entities = new Map<string, PrimitiveEntity>();
  private destroyed = false;

  constructor(scene: Cesium.Scene) {
    this.scene = scene;
    this.points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.billboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    this.labels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
  }

  /** Get count of managed entities. */
  get count(): number {
    return this.entities.size;
  }

  /**
   * Add or update an entity by ID.
   * Entities with an `image` property use BillboardCollection;
   * all others use PointPrimitiveCollection.
   * Labels are added to LabelCollection when `label` is provided.
   */
  upsert(entity: PrimitiveEntity): void {
    if (this.destroyed) return;
    if (!isValidPosition(entity.position)) return;

    const existing = this.indexMap.get(entity.id);
    this.entities.set(entity.id, entity);

    if (existing) {
      this.updateExisting(entity, existing);
    } else {
      this.addNew(entity);
    }
  }

  /**
   * Remove a single entity by ID.
   * Triggers a full rebuild of affected collections since primitive
   * indices shift on removal.
   */
  remove(id: string): void {
    if (this.destroyed) return;
    if (!this.entities.has(id)) return;
    this.entities.delete(id);
    this.rebuild();
  }

  /**
   * Remove all entities whose IDs are NOT in the given set.
   * Call this after each feed poll with the set of active IDs
   * to garbage-collect stale entries.
   */
  reconcile(activeIds: Set<string>): void {
    if (this.destroyed) return;

    let needsRebuild = false;
    for (const id of this.entities.keys()) {
      if (!activeIds.has(id)) {
        this.entities.delete(id);
        needsRebuild = true;
      }
    }

    if (needsRebuild) {
      this.rebuild();
    }
  }

  /** Remove all entities and clear collections. */
  clear(): void {
    if (this.destroyed) return;
    this.entities.clear();
    this.indexMap.clear();
    this.points.removeAll();
    this.billboards.removeAll();
    this.labels.removeAll();
  }

  /** Destroy all collections and remove them from the scene. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.entities.clear();
    this.indexMap.clear();

    try {
      this.scene.primitives.remove(this.points);
      this.scene.primitives.remove(this.billboards);
      this.scene.primitives.remove(this.labels);
    } catch {
      // Scene may already be destroyed
    }
  }

  // ── Private ──────────────────────────────────────────────

  private addNew(entity: PrimitiveEntity): void {
    const entry: IndexEntry = {};

    if (entity.image) {
      const bb = this.billboards.add({
        position: entity.position,
        image: entity.image as unknown as string,
        width: entity.imageWidth,
        height: entity.imageHeight,
        rotation: entity.rotation ?? 0,
        color: entity.color ?? Cesium.Color.WHITE,
        distanceDisplayCondition: entity.distanceDisplayCondition,
      });
      entry.billboardIdx = this.billboards.length - 1;
    } else {
      const pt = this.points.add({
        position: entity.position,
        pixelSize: entity.pixelSize ?? 6,
        color: entity.color ?? Cesium.Color.WHITE,
        distanceDisplayCondition: entity.distanceDisplayCondition,
      });
      entry.pointIdx = this.points.length - 1;
    }

    if (entity.label) {
      const lbl = this.labels.add({
        position: entity.position,
        text: entity.label,
        font: entity.labelFont ?? '12px sans-serif',
        fillColor: entity.labelColor ?? Cesium.Color.WHITE,
        pixelOffset: entity.labelOffset ?? new Cesium.Cartesian2(8, 0),
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        outlineColor: Cesium.Color.BLACK,
        distanceDisplayCondition: entity.labelDistanceDisplayCondition,
      });
      entry.labelIdx = this.labels.length - 1;
    }

    this.indexMap.set(entity.id, entry);
  }

  private updateExisting(entity: PrimitiveEntity, entry: IndexEntry): void {
    if (entry.billboardIdx != null) {
      const bb = this.billboards.get(entry.billboardIdx);
      if (bb) {
        bb.position = entity.position;
        if (entity.color) bb.color = entity.color;
        if (entity.rotation != null) bb.rotation = entity.rotation;
        if (entity.image) bb.image = entity.image as unknown as string;
      }
    }

    if (entry.pointIdx != null) {
      const pt = this.points.get(entry.pointIdx);
      if (pt) {
        pt.position = entity.position;
        if (entity.color) pt.color = entity.color;
        if (entity.pixelSize != null) pt.pixelSize = entity.pixelSize;
      }
    }

    if (entry.labelIdx != null) {
      const lbl = this.labels.get(entry.labelIdx);
      if (lbl) {
        lbl.position = entity.position;
        if (entity.label != null) lbl.text = entity.label;
        if (entity.labelColor) lbl.fillColor = entity.labelColor;
      }
    }
  }

  /**
   * Rebuild all three collections from the entity map.
   * This is the "mark and rebuild" strategy: cheaper than trying
   * to track shifting indices on individual removals, and still
   * far faster than the Entity API for large counts.
   */
  private rebuild(): void {
    this.points.removeAll();
    this.billboards.removeAll();
    this.labels.removeAll();
    this.indexMap.clear();

    for (const entity of this.entities.values()) {
      if (isValidPosition(entity.position)) {
        this.addNew(entity);
      }
    }
  }
}

/** Guard against NaN/Infinity positions that would corrupt the collection. */
function isValidPosition(pos: Cesium.Cartesian3): boolean {
  return (
    pos != null &&
    Number.isFinite(pos.x) &&
    Number.isFinite(pos.y) &&
    Number.isFinite(pos.z)
  );
}
