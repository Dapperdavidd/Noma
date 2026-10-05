import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Plus,
  Building2,
  MessageCircle,
  CalendarCheck,
  Star,
} from "lucide-react";
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
type Inspection = {
  id: string;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  proposed_at: string;
  note: string;
  role: "host" | "guest";
  reviewed: boolean;
  property: { id: string; title: string; slug: string };
  other_party: { id: string; name: string };
};
export function Dashboard() {
  const { user } = useAuth();
  const [items, setItems] = useState<Property[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
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
      const [p, l, totals, visits] = await Promise.all([
        api<Page<Property>>("/dashboard/properties"),
        api<Page<Lead>>("/dashboard/inquiries"),
        api<Summary>("/dashboard/summary"),
        api<Inspection[]>("/dashboard/inspections"),
      ]);
      setItems(p.data);
      setPropertyCursor(p.next_cursor);
      setLeads(l.data);
      setLeadCursor(l.next_cursor);
      setSummary(totals);
      setInspections(visits);
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
  async function inspectionStatus(id: string, value: string) {
    setError("");
    try {
      await api(`/inspections/${id}`, {
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
          <div className="eyebrow">YOUR PROPERTY SPACE</div>
          <h1>A little overview.</h1>
        </div>
        <Link className="button olive" to="/dashboard/new">
          <Plus size={18} /> New property
        </Link>
      </div>
      <div className="dashboard-links">
        {(user?.role === "agent" || user?.role === "admin") && (
          <Link className="text-link" to="/dashboard/profile">
            Edit agent profile <ArrowUpRight size={15} />
          </Link>
        )}
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
        <button
          className={tab === "inspections" ? "active" : ""}
          onClick={() => setTab("inspections")}
        >
          Inspections
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
      ) : tab === "inquiries" ? (
        leads.length ? (
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
        )
      ) : inspections.length ? (
        <div className="inspection-list">
          {inspections.map((inspection) => (
            <article key={inspection.id}>
              <div className="inspection-heading">
                <div>
                  <span className="status-pill">{inspection.status}</span>
                  <h3>{inspection.property.title}</h3>
                  <p className="muted">
                    {inspection.role === "host" ? "Customer" : "Agent"}:{" "}
                    {inspection.other_party.name}
                  </p>
                </div>
                <CalendarCheck size={25} />
              </div>
              <p>
                {new Date(inspection.proposed_at).toLocaleString("en-NG", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              <p>{inspection.note}</p>
              <div className="inspection-actions">
                <Link
                  className="text-link"
                  to={`/properties/${inspection.property.slug}`}
                >
                  View property <ArrowUpRight size={14} />
                </Link>
                {inspection.role === "host" &&
                  inspection.status === "requested" && (
                    <>
                      <button
                        className="button olive"
                        onClick={() =>
                          void inspectionStatus(inspection.id, "confirmed")
                        }
                      >
                        Confirm
                      </button>
                      <button
                        className="button ghost"
                        onClick={() =>
                          void inspectionStatus(inspection.id, "cancelled")
                        }
                      >
                        Decline
                      </button>
                    </>
                  )}
                {inspection.role === "host" &&
                  inspection.status === "confirmed" && (
                    <>
                      <button
                        className="button olive"
                        onClick={() =>
                          void inspectionStatus(inspection.id, "completed")
                        }
                      >
                        Mark completed
                      </button>
                      <button
                        className="button ghost"
                        onClick={() =>
                          void inspectionStatus(inspection.id, "cancelled")
                        }
                      >
                        Cancel
                      </button>
                    </>
                  )}
                {inspection.role === "guest" &&
                  ["requested", "confirmed"].includes(inspection.status) && (
                    <button
                      className="button ghost"
                      onClick={() =>
                        void inspectionStatus(inspection.id, "cancelled")
                      }
                    >
                      Cancel request
                    </button>
                  )}
              </div>
              {inspection.role === "guest" &&
                inspection.status === "completed" &&
                !inspection.reviewed && (
                  <ReviewForm
                    inspectionId={inspection.id}
                    onSaved={load}
                    onError={setError}
                  />
                )}
              {inspection.reviewed && (
                <p className="verified">
                  <Star size={15} fill="currentColor" /> Review submitted
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <CalendarCheck size={40} />
          <h2>No inspections yet.</h2>
          <p>Inspection requests and completed visits will appear here.</p>
        </div>
      )}
    </>
  );
}

function ReviewForm({
  inspectionId,
  onSaved,
  onError,
}: {
  inspectionId: string;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    onError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/inspections/${inspectionId}/review`, {
        method: "POST",
        body: JSON.stringify({
          ...values,
          rating: Number(values.rating),
          communication: Number(values.communication),
          punctuality: Number(values.punctuality),
          property_accuracy: Number(values.property_accuracy),
          professionalism: Number(values.professionalism),
        }),
      });
      await onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="review-form" onSubmit={submit}>
      <h4>Rate this agent</h4>
      <div className="review-scores">
        {[
          ["rating", "Overall"],
          ["communication", "Communication"],
          ["punctuality", "Punctuality"],
          ["property_accuracy", "Property accuracy"],
          ["professionalism", "Professionalism"],
        ].map(([name, label]) => (
          <label key={name}>
            {label}
            <select name={name} defaultValue="5">
              {[5, 4, 3, 2, 1].map((score) => (
                <option key={score} value={score}>
                  {score} / 5
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label>
        Your review
        <textarea
          name="comment"
          minLength={10}
          maxLength={1500}
          required
          placeholder="Share what happened during the inspection."
        />
      </label>
      <button className="button olive" disabled={busy}>
        {busy ? "Submitting…" : "Submit verified review"}
      </button>
    </form>
  );
}
