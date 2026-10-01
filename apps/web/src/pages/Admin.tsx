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
export function Admin() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const value = await api<{
        properties: Property[];
        agents: Agent[];
        reports: Report[];
      }>("/admin/queue");
      setProperties(value.properties);
      setAgents(value.agents);
      setReports(value.reports);
    } catch (e) {
      setError((e as Error).message);
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
                      <option value="verify">Verify property</option>
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
      {!agents.length && <p className="muted">No agents awaiting review.</p>}
    </>
  );
}
