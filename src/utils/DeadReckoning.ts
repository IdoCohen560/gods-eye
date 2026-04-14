/**
 * Tracked position with computed velocity for dead-reckoning interpolation.
 */
export interface TrackedPosition {
  id: string;
  currentLon: number;
  currentLat: number;
  currentAlt: number;
  velocityLon: number; // degrees per second
  velocityLat: number;
  velocityAlt: number;
  lastUpdateTime: number; // ms since epoch
}

/**
 * Simple dead-reckoning engine for smooth entity movement between API polls.
 *
 * On each API poll, call `update()` with the new position. The engine computes
 * velocity from the delta between the previous and current positions.
 *
 * On each render frame, call `getPosition()` to get a linearly extrapolated
 * position based on elapsed time since the last update.
 */
export class DeadReckoningEngine {
  private tracked = new Map<string, TrackedPosition>();

  /** Maximum extrapolation time in ms. Beyond this, velocity is zeroed to prevent drift. */
  private maxExtrapolationMs: number;

  /**
   * @param maxExtrapolationMs Stop extrapolating after this many ms without an update.
   *   Defaults to 30000 (30s). Prevents runaway drift if a feed stops reporting.
   */
  constructor(maxExtrapolationMs = 30_000) {
    this.maxExtrapolationMs = maxExtrapolationMs;
  }

  /**
   * Update with a new position from an API poll.
   * Computes velocity from the previous position if one exists.
   */
  update(id: string, lon: number, lat: number, alt: number): void {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(alt)) {
      return;
    }

    const now = performance.now();
    const prev = this.tracked.get(id);

    if (prev) {
      const dt = (now - prev.lastUpdateTime) / 1000; // seconds
      if (dt > 0.01) {
        prev.velocityLon = (lon - prev.currentLon) / dt;
        prev.velocityLat = (lat - prev.currentLat) / dt;
        prev.velocityAlt = (alt - prev.currentAlt) / dt;
      }
      prev.currentLon = lon;
      prev.currentLat = lat;
      prev.currentAlt = alt;
      prev.lastUpdateTime = now;
    } else {
      this.tracked.set(id, {
        id,
        currentLon: lon,
        currentLat: lat,
        currentAlt: alt,
        velocityLon: 0,
        velocityLat: 0,
        velocityAlt: 0,
        lastUpdateTime: now,
      });
    }
  }

  /**
   * Get the interpolated (dead-reckoned) position at the current time.
   * Returns null if the entity is not tracked.
   */
  getPosition(id: string): { lon: number; lat: number; alt: number } | null {
    const entry = this.tracked.get(id);
    if (!entry) return null;

    const elapsed = performance.now() - entry.lastUpdateTime; // ms
    if (elapsed > this.maxExtrapolationMs) {
      // Stale: return last known position without extrapolation
      return {
        lon: entry.currentLon,
        lat: entry.currentLat,
        alt: entry.currentAlt,
      };
    }

    const dt = elapsed / 1000; // seconds
    return {
      lon: entry.currentLon + entry.velocityLon * dt,
      lat: entry.currentLat + entry.velocityLat * dt,
      alt: entry.currentAlt + entry.velocityAlt * dt,
    };
  }

  /** Remove a tracked entity. */
  remove(id: string): void {
    this.tracked.delete(id);
  }

  /** Clear all tracked entities. */
  clear(): void {
    this.tracked.clear();
  }

  /** Number of currently tracked entities. */
  get count(): number {
    return this.tracked.size;
  }
}
