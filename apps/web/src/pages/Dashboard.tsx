import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Plus, Building2, MessageCircle } from "lucide-react";
import { api, money, type Property } from "../api";
import { hero } from "../demo";
import { Notice } from "../components";

type Lead = {
  id: string;
  name: string;
  email: string;
  message: string;
  property: string;
  status: string;
};
export function Dashboard() {
  const [items, setItems] = useState<Property[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("properties");
  async function load() {
    try {
      const [p, l] = await Promise.all([
        api<{ data: Property[] }>("/dashboard/properties"),
        api<Lead[]>("/dashboard/inquiries"),
      ]);
      setItems(p.data);
      setLeads(l);
    } catch (e) {
      setError((e as Error).message);
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
      <div className="metrics">
        <div>
          <span>Total properties</span>
          <strong>{items.length}</strong>
        </div>
        <div>
          <span>Active listings</span>
          <strong>{items.filter((p) => p.status === "active").length}</strong>
        </div>
        <div>
          <span>Inquiries</span>
          <strong>{leads.length}</strong>
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
        <div className="leads">
          {leads.map((l) => (
            <article key={l.id}>
              <span className="status-pill">{l.status}</span>
              <h3>{l.name}</h3>
              <p className="muted">{l.property}</p>
              <p>{l.message}</p>
              <a className="text-link" href={`mailto:${l.email}`}>
                Reply by email <ArrowUpRight size={16} />
              </a>
            </article>
          ))}
        </div>
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
