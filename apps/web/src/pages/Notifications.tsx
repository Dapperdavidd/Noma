import { useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Notice } from "../components";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  read_at: string | null;
  created_at: string;
};

type Feed = { data: Notification[]; unread: number };

export function Notifications() {
  const [feed, setFeed] = useState<Feed>({ data: [], unread: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Feed>("/notifications")
      .then(setFeed)
      .catch((e) => setError(e.message));
  }, []);

  async function read(notification: Notification) {
    if (notification.read_at) return;
    try {
      await api(`/notifications/${notification.id}/read`, { method: "PATCH" });
      setFeed((current) => ({
        unread: Math.max(0, current.unread - 1),
        data: current.data.map((item) =>
          item.id === notification.id
            ? { ...item, read_at: new Date().toISOString() }
            : item,
        ),
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function readAll() {
    setBusy(true);
    try {
      await api("/notifications/read-all", { method: "POST" });
      const now = new Date().toISOString();
      setFeed((current) => ({
        unread: 0,
        data: current.data.map((item) => ({
          ...item,
          read_at: item.read_at || now,
        })),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-heading notification-heading">
        <div>
          <div className="eyebrow">YOUR NOMA ACTIVITY</div>
          <h1>Notifications.</h1>
          <p className="muted">
            Inquiries, inspections and reviews connected to your account.
          </p>
        </div>
        {feed.unread > 0 && (
          <button className="button outline" disabled={busy} onClick={readAll}>
            <CheckCheck size={17} />
            {busy ? "Updating…" : "Mark all as read"}
          </button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {feed.data.length ? (
        <div className="notification-list">
          {feed.data.map((notification) => (
            <Link
              key={notification.id}
              to={notification.href}
              className={notification.read_at ? "" : "unread"}
              onClick={() => void read(notification)}
            >
              <Bell size={18} />
              <div>
                <div className="notification-title">
                  <strong>{notification.title}</strong>
                  {!notification.read_at && <span>New</span>}
                </div>
                <p>{notification.body}</p>
                <time dateTime={notification.created_at}>
                  {new Date(notification.created_at).toLocaleString("en-NG", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Bell size={40} />
          <h2>Everything is quiet.</h2>
          <p>New inquiries, inspections and reviews will appear here.</p>
        </div>
      )}
    </>
  );
}
