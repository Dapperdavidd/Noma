import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Plus, Building2, MessageCircle } from "lucide-react";
import { api, money, type Property } from "../api";
import { hero } from "../demo";
import { useAuth } from "../auth";
import { Notice } from "../components";

type Lead = {
  id: string;
  name: string;
  email: string;
  message: string;
  property: string;
  status: string;
};
type Page<T> = { data: T[]; next_cursor: string | null };
type Summary = {
  total_properties: number;
  active_properties: number;
  inquiries: number;
};
export function Dashboard() {
  const { user } = useAuth();
  const [items, setItems] = useState<Property[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [propertyCursor, setPropertyCursor] = useState<string | null>(null);
  const [leadCursor, setLeadCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary>({
    total_properties: 0,
    active_properties: 0,
    inquiries: 0,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("properties");
  async function load() {
    try {
      const [p, l, totals] = await Promise.all([
        api<Page<Property>>("/dashboard/properties"),
        api<Page<Lead>>("/dashboard/inquiries"),
        api<Summary>("/dashboard/summary"),
      ]);
      setItems(p.data);
      setPropertyCursor(p.next_cursor);
      setLeads(l.data);
      setLeadCursor(l.next_cursor);
      setSummary(totals);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function showMore(kind: "properties" | "inquiries") {
    const cursor = kind === "properties" ? propertyCursor : leadCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      if (kind === "properties") {
        const page = await api<Page<Property>>(
          `/dashboard/properties?cursor=${encodeURIComponent(cursor)}`,
        );
        setItems((current) => [...current, ...page.data]);
        setPropertyCursor(page.next_cursor);
      } else {
        const page = await api<Page<Lead>>(
          `/dashboard/inquiries?cursor=${encodeURIComponent(cursor)}`,
        );
        setLeads((current) => [...current, ...page.data]);
        setLeadCursor(page.next_cursor);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function status(p: Property, value: string) {
    try {
      await api(`/properties/${p.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: value }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <div className="eyebrow">YOUR AGENT SPACE</div>
          <h1>A little overview.</h1>
        </div>
        <Link className="button olive" to="/dashboard/new">
          <Plus size={18} /> New property
        </Link>
      </div>
      <div className="dashboard-links">
        <Link className="text-link" to="/dashboard/profile">
          Edit agent profile <ArrowUpRight size={15} />
        </Link>
        {user?.role === "admin" && (
          <Link className="text-link" to="/admin">
            Review and verification <ArrowUpRight size={15} />
          </Link>
        )}
      </div>
      <div className="metrics">
        <div>
          <span>Total properties</span>
          <strong>{summary.total_properties}</strong>
        </div>
        <div>
          <span>Active listings</span>
          <strong>{summary.active_properties}</strong>
        </div>
        <div>
          <span>Inquiries</span>
          <strong>{summary.inquiries}</strong>
        </div>
      </div>
      <div className="dashboard-tabs">
        <button
          className={tab === "properties" ? "active" : ""}
          onClick={() => setTab("properties")}
        >
          Your properties
        </button>
        <button
          className={tab === "inquiries" ? "active" : ""}
          onClick={() => setTab("inquiries")}
        >
          Inquiries
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
      {tab === "properties" ? (
        items.length ? (
          <>
            <div className="management-list">
              {items.map((p) => (
                <article key={p.id}>
                  <img src={p.cover_image || hero} alt={p.title} />
                  <div>
                    <Link to={`/properties/${p.slug}`}>
                      <h3>{p.title}</h3>
                    </Link>
                    <p>
                      {money(p.price)} · {p.city}
                    </p>
                    <span className="status-pill">{p.status}</span>
                  </div>
                  <Link className="text-link" to={`/dashboard/edit/${p.slug}`}>
                    Edit <ArrowUpRight size={15} />
                  </Link>
                  <select
                    aria-label={`Status of ${p.title}`}
                    value={p.status}
                    onChange={(e) => status(p, e.target.value)}
                    disabled={p.status === "suspended"}
                  >
                    {[
                      "draft",
                      "active",
                      "sold",
                      "rented",
                      "expired",
                      ...(p.status === "suspended" ? ["suspended"] : []),
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </article>
              ))}
            </div>
            {propertyCursor && (
              <button
                className="button ghost load-more"
                onClick={() => void showMore("properties")}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Show more properties"}
              </button>
            )}
          </>
        ) : (
          <div className="empty">
            <Building2 size={40} />
            <h2>Your first listing starts here.</h2>
            <p>
              Add the details, show the space, and publish when you’re ready.
            </p>
            <Link className="button olive" to="/dashboard/new">
              Create a property <Plus size={16} />
            </Link>
          </div>
        )
      ) : leads.length ? (
        <>
          <div className="leads">
            {leads.map((l) => (
              <article key={l.id}>
                <select
                  aria-label={`Inquiry status for ${l.name}`}
                  value={l.status}
                  onChange={async (e) => {
                    try {
                      await api(`/dashboard/inquiries/${l.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: e.target.value }),
                      });
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {["new", "contacted", "closed"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <h3>{l.name}</h3>
                <p className="muted">{l.property}</p>
                <p>{l.message}</p>
                <a className="text-link" href={`mailto:${l.email}`}>
                  Reply by email <ArrowUpRight size={16} />
                </a>
              </article>
            ))}
          </div>
          {leadCursor && (
            <button
              className="button ghost load-more"
              onClick={() => void showMore("inquiries")}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Show more inquiries"}
            </button>
          )}
        </>
      ) : (
        <div className="empty">
          <MessageCircle size={40} />
          <h2>Good conversations start here.</h2>
          <p>Inquiries about your properties will appear in this space.</p>
        </div>
      )}
    </>
  );
}
