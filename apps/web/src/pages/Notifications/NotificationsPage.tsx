import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

interface NotificationItem {
  id: string;
  category: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export const NotificationsPage: React.FC = () => {
  const { token } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);

  const load = () => {
    if (!token) return;
    apiFetch<{ notifications?: NotificationItem[] }>('/notifications')
      .then((res) => setItems(Array.isArray(res?.notifications) ? res.notifications : []))
      .catch(() => {});
  };

  useEffect(load, [token]);

  const markRead = async (id: string) => {
    await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
    load();
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
        <div className="flex items-center gap-2.5">
          <Bell className="w-5 h-5 text-blue-600" />
          <h1 className="font-bold text-base">Notifications &amp; Alerts</h1>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-500">
          No notifications yet. Connection status changes, TP/SL triggers, and administrator announcements appear here.
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((n) => (
            <div
              key={n.id}
              className={`rounded-xl border p-4 flex items-start justify-between gap-3 ${
                n.is_read
                  ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-75'
                  : 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
              }`}
            >
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">{n.category}</div>
                <div className="font-bold text-sm">{n.title}</div>
                <p className="text-xs text-slate-600 dark:text-slate-300">{n.message}</p>
                <div className="text-[11px] font-mono text-slate-400">
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
              {!n.is_read && (
                <button
                  type="button"
                  onClick={() => markRead(n.id)}
                  className="text-xs font-semibold text-emerald-600 flex items-center gap-1 shrink-0"
                >
                  <CheckCircle2 className="w-4 h-4" /> Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
