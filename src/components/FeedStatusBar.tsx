import { useFeedStatuses, type FeedStatus } from '../hooks/useFeedStatus';

const FEED_NAMES: Record<string, string> = {
  aircraft: 'AIRCRAFT',
  satellites: 'SATELLITES',
  cctv: 'CCTV',
  ships: 'SHIPS',
  conflicts: 'CONFLICTS',
  earthquakes: 'QUAKES',
  fires: 'FIRES',
  traffic: 'TRAFFIC',
};

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'now';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function dotColor(status: FeedStatus['status']): string {
  switch (status) {
    case 'online': return 'var(--accent-green)';
    case 'degraded': return 'var(--accent-amber)';
    case 'offline': return 'var(--accent-red)';
    case 'loading': return 'var(--text-dim)';
  }
}

export default function FeedStatusBar() {
  const statuses = useFeedStatuses();

  if (statuses.size === 0) return null;

  return (
    <div className="feed-status-bar">
      <h3>FEED STATUS</h3>
      {Array.from(statuses.values()).map(s => (
        <div key={s.feed} className="feed-status-row" title={s.error || s.status}>
          <span className="feed-status-dot" style={{ background: dotColor(s.status) }} />
          <span className="feed-status-name">{FEED_NAMES[s.feed] || s.feed.toUpperCase()}</span>
          <span className="feed-status-time">{timeAgo(s.lastUpdate)}</span>
        </div>
      ))}
    </div>
  );
}
