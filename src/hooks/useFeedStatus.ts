import { useState, useEffect, useCallback } from 'react';

export interface FeedStatus {
  feed: string;
  status: 'online' | 'degraded' | 'offline' | 'loading';
  lastUpdate: number;
  error?: string;
}

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'warning' | 'info';
  timestamp: number;
}

// --- Feed Status ---
const feedStatuses = new Map<string, FeedStatus>();
type StatusListener = (statuses: Map<string, FeedStatus>) => void;
const statusListeners = new Set<StatusListener>();

export function reportFeedStatus(feed: string, status: FeedStatus['status'], error?: string): void {
  feedStatuses.set(feed, { feed, status, lastUpdate: Date.now(), error });
  const snapshot = new Map(feedStatuses);
  statusListeners.forEach(fn => fn(snapshot));
}

export function useFeedStatuses(): Map<string, FeedStatus> {
  const [statuses, setStatuses] = useState<Map<string, FeedStatus>>(() => new Map(feedStatuses));

  useEffect(() => {
    const listener: StatusListener = (s) => setStatuses(s);
    statusListeners.add(listener);
    return () => { statusListeners.delete(listener); };
  }, []);

  return statuses;
}

// --- Toasts ---
let toasts: Toast[] = [];
type ToastListener = (toasts: Toast[]) => void;
const toastListeners = new Set<ToastListener>();
const lastToastPerFeed = new Map<string, number>();

function notifyToastListeners() {
  const snapshot = [...toasts];
  toastListeners.forEach(fn => fn(snapshot));
}

export function reportToast(message: string, type: Toast['type'], feedKey?: string): void {
  // Debounce: 1 toast per feed per 60s
  if (feedKey) {
    const last = lastToastPerFeed.get(feedKey) || 0;
    if (Date.now() - last < 60_000) return;
    lastToastPerFeed.set(feedKey, Date.now());
  }

  const toast: Toast = { id: `${Date.now()}-${Math.random()}`, message, type, timestamp: Date.now() };
  toasts = [toast, ...toasts].slice(0, 3);
  notifyToastListeners();

  // Auto-dismiss after 8s
  setTimeout(() => { dismissToast(toast.id); }, 8000);
}

export function dismissToast(id: string): void {
  toasts = toasts.filter(t => t.id !== id);
  notifyToastListeners();
}

export function useToasts(): Toast[] {
  const [current, setCurrent] = useState<Toast[]>([]);

  useEffect(() => {
    const listener: ToastListener = (t) => setCurrent(t);
    toastListeners.add(listener);
    return () => { toastListeners.delete(listener); };
  }, []);

  return current;
}
