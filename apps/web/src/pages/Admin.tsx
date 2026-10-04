import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type Property } from "../api";
import { Notice } from "../components";
import { useAuth } from "../auth";
type Agent = { id: string; name: string; agency_name: string | null };
type Report = {
  id: string;
  category: string;
  details: string;
  property: string;
  slug: string;
  reporter: string;
  reporter_email: string;
};
type Page<T> = { data: T[]; next_cursor: string | null };
type Metrics = {
  total_users: number;
  active_users: number;
  property_seekers: number;
  new_users_today: number;
  total_properties: number;
  published_properties: number;
  properties_updated_today: number;
  photos_uploaded_today: number;
  videos_uploaded_today: number;
  open_reports: number;
};
export function Admin() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [cursors, setCursors] = useState({
    properties: null as string | null,
    agents: null as string | null,
    reports: null as string | null,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  async function load() {
    try {
      const [propertyPage, agentPage, reportPage, nextMetrics] =
        await Promise.all([
          api<Page<Property>>("/admin/queue/properties"),
          api<Page<Agent>>("/admin/queue/agents"),
          api<Page<Report>>("/admin/queue/reports"),
          api<Metrics>("/admin/metrics"),
        ]);
      setProperties(propertyPage.data);
      setAgents(agentPage.data);
      setReports(reportPage.data);
      setMetrics(nextMetrics);
      setCursors({
        properties: propertyPage.next_cursor,
        agents: agentPage.next_cursor,
        reports: reportPage.next_cursor,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function showMore(kind: "properties" | "agents" | "reports") {
    const cursor = cursors[kind];
    if (!cursor || busy) return;
    setBusy(true);
    setError("");
    try {
      const path = `/admin/queue/${kind}?cursor=${encodeURIComponent(cursor)}`;
      if (kind === "properties") {
        const page = await api<Page<Property>>(path);
        setProperties((current) => [...current, ...page.data]);
        setCursors((current) => ({
          ...current,
          properties: page.next_cursor,
        }));
      } else if (kind === "agents") {
        const page = await api<Page<Agent>>(path);
        setAgents((current) => [...current, ...page.data]);
        setCursors((current) => ({
          ...current,
          agents: page.next_cursor,
        }));
      } else {
        const page = await api<Page<Report>>(path);
        setReports((current) => [...current, ...page.data]);
        setCursors((current) => ({
          ...current,
          reports: page.next_cursor,
        }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resolveReport(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/admin/reports/${id}`, {
        method: "PATCH",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      setError("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (user?.role === "admin") void load();
  }, [user]);
  async function review(
    e: FormEvent<HTMLFormElement>,
    id: string,
    target_type: string,
  ) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/admin/reviews/${id}`, {
        method: "POST",
        body: JSON.stringify({
          ...Object.fromEntries(new FormData(e.currentTarget)),
          target_type,
        }),
      });
      setError("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (user?.role !== "admin")
    return <Notice>Administrator access is required.</Notice>;
  return (
    <>
      <div className="eyebrow">TRUST STARTS WITH CARE</div>
      <h1>Review and verification.</h1>
      <p className="muted">
        Verify only after completing your evidence checks. Every decision
        records your account and review reason.
      </p>
      {error && <Notice>{error}</Notice>}
      {metrics && (
        <section className="admin-overview" aria-label="Marketplace overview">
          {[
            ["Total users", metrics.total_users],
            ["Users with active sessions", metrics.active_users],
            ["Property seekers", metrics.property_seekers],
            ["New users today", metrics.new_users_today],
            ["All properties", metrics.total_properties],
            ["Published properties", metrics.published_properties],
            ["Properties updated today", metrics.properties_updated_today],
            ["Photos uploaded today", metrics.photos_uploaded_today],
            ["Videos uploaded today", metrics.videos_uploaded_today],
            ["Open reports", metrics.open_reports],
          ].map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
      )}
      <h2>Listing reports</h2>
      <div className="leads">
        {reports.map((report) => (
          <article key={report.id}>
            <span className="status-pill">
              {report.category.replaceAll("_", " ")}
            </span>
            <Link to={`/properties/${report.slug}`}>
              <h3>{report.property}</h3>
            </Link>
            <p>{report.details}</p>
            <p className="muted">
              Reported by {report.reporter} · {report.reporter_email}
            </p>
            <form onSubmit={(e) => resolveReport(e, report.id)}>
              <label>
                Decision
                <select name="action">
                  <option value="resolved">Resolve</option>
                  <option value="dismissed">Dismiss</option>
                </select>
              </label>
              <label>
                Decision reason
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={2000}
                />
              </label>
              <button className="button olive" disabled={busy}>
                Record decision
              </button>
            </form>
          </article>
        ))}
      </div>
      {cursors.reports && (
        <button
          className="button ghost load-more"
          onClick={() => void showMore("reports")}
          disabled={busy}
        >
          Show more reports
        </button>
      )}
      {!reports.length && <p className="muted">No open listing reports.</p>}
      <h2>Properties</h2>
      <div className="leads">
        {properties.map((p) => (
          <article key={p.id}>
            <Link to={`/properties/${p.slug}`}>
              <h3>{p.title}</h3>
            </Link>
            <p className="muted">
              {p.city} · {p.status}
            </p>
            <form onSubmit={(e) => review(e, p.id, "property")}>
              <label>
                Decision
                <select name="action">
                  {p.status === "suspended" ? (
                    <option value="restore">Restore to draft</option>
                  ) : (
                    <>
                      {!p.is_verified && (
                        <option value="verify">Verify property</option>
                      )}
                      <option value={p.is_featured ? "unfeature" : "feature"}>
                        {p.is_featured
                          ? "Remove featured placement"
                          : "Feature for 30 days"}
                      </option>
                      <option value="suspend">Suspend property</option>
                    </>
                  )}
                </select>
              </label>
              <label>
                Review reason
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={2000}
                />
              </label>
              <button className="button olive" disabled={busy}>
                Record decision
              </button>
            </form>
          </article>
        ))}
      </div>
      {cursors.properties && (
        <button
          className="button ghost load-more"
          onClick={() => void showMore("properties")}
          disabled={busy}
        >
          Show more properties
        </button>
      )}
      {!properties.length && (
        <p className="muted">No properties awaiting review.</p>
      )}
      <h2 className="admin-agents-title">Agents</h2>
      <div className="leads">
        {agents.map((a) => (
          <article key={a.id}>
            <h3>{a.name}</h3>
            <p>{a.agency_name || "Independent agent"}</p>
            <form onSubmit={(e) => review(e, a.id, "agent")}>
              <label>
                Decision
                <select name="action">
                  <option value="verify">Verify agent</option>
                  <option value="reject">Reject verification</option>
                </select>
              </label>
              <label>
                Review reason
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={2000}
                />
              </label>
              <button className="button olive" disabled={busy}>
                Record decision
              </button>
            </form>
          </article>
        ))}
      </div>
      {cursors.agents && (
        <button
          className="button ghost load-more"
          onClick={() => void showMore("agents")}
          disabled={busy}
        >
          Show more agents
        </button>
      )}
      {!agents.length && <p className="muted">No agents awaiting review.</p>}
    </>
  );
}
