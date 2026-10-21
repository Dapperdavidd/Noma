import { useEffect, useState } from "react";
import { BadgeCheck, CreditCard, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api, money, type Property } from "../api";
import { Notice } from "../components";

type Product = {
  id: string;
  name: string;
  description: string;
  kind: "agent_subscription" | "featured_listing";
  price_kobo: number;
  duration_days: number;
};
type Purchase = {
  id: string;
  reference: string;
  status: string;
  amount_kobo: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
  product: string;
  property_id: string | null;
};
type Catalog = { enabled: boolean; data: Product[] };
type Page<T> = { data: T[] };

export function Billing() {
  const [params] = useSearchParams();
  const [catalog, setCatalog] = useState<Catalog>({ enabled: false, data: [] });
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState(params.get("property") || "");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const [nextCatalog, history, listings] = await Promise.all([
        api<Catalog>("/billing/products"),
        api<Purchase[]>("/billing/purchases"),
        api<Page<Property>>("/dashboard/properties?limit=50"),
      ]);
      setCatalog(nextCatalog);
      setPurchases(history);
      const active = listings.data.filter(
        (property) => property.status === "active",
      );
      setProperties(active);
      setPropertyId((current) => current || active[0]?.id || "");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    const reference = params.get("reference") || params.get("trxref");
    if (!reference) {
      void load();
      return;
    }
    setBusy("verify");
    api<{ status: string }>(
      `/billing/verify/${encodeURIComponent(reference)}`,
      {
        method: "POST",
      },
    )
      .then((purchase) => {
        setMessage(
          purchase.status === "succeeded"
            ? "Payment confirmed. Your NOMA benefit is now active."
            : "Payment has not been confirmed yet. You can safely refresh this page.",
        );
        return load();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(""));
  }, []);

  async function checkout(product: Product) {
    setBusy(product.id);
    setError("");
    setMessage("");
    try {
      const result = await api<{ checkout_url: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({
          product_id: product.id,
          property_id: product.kind === "featured_listing" ? propertyId : null,
        }),
      });
      window.location.assign(result.checkout_url);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }

  return (
    <>
      <div className="eyebrow">GROW WITH NOMA</div>
      <div className="section-heading billing-heading">
        <div>
          <h1>Plans and promotion.</h1>
          <p className="muted">
            Promote strong listings and manage every payment from one place.
          </p>
        </div>
        <Link className="text-link" to="/dashboard">
          Property dashboard
        </Link>
      </div>
      {error && <Notice>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {!catalog.enabled && (
        <Notice>
          Paid plans are not open during early access. Your ordinary listings
          and account remain available.
        </Notice>
      )}
      <div className="billing-products">
        {catalog.data.map((product) => (
          <article key={product.id}>
            {product.kind === "featured_listing" ? (
              <Sparkles size={25} />
            ) : (
              <BadgeCheck size={25} />
            )}
            <span className="eyebrow">{product.duration_days} DAYS</span>
            <h2>{product.name}</h2>
            <p>{product.description}</p>
            <strong>{money(product.price_kobo / 100)}</strong>
            {product.kind === "featured_listing" && (
              <label>
                Property to promote
                <select
                  value={propertyId}
                  onChange={(event) => setPropertyId(event.target.value)}
                >
                  <option value="">Choose an active property</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="button olive full"
              disabled={
                !catalog.enabled ||
                busy !== "" ||
                (product.kind === "featured_listing" && !propertyId)
              }
              onClick={() => void checkout(product)}
            >
              <CreditCard size={16} />
              {busy === product.id
                ? "Opening checkout…"
                : "Continue to payment"}
            </button>
          </article>
        ))}
      </div>
      <section className="billing-history">
        <h2>Payment history</h2>
        {busy === "verify" && <p className="muted">Confirming payment…</p>}
        {purchases.length ? (
          <div className="management-list">
            {purchases.map((purchase) => (
              <article key={purchase.id}>
                <CreditCard size={22} />
                <div>
                  <h3>{purchase.product}</h3>
                  <p className="muted">
                    {new Date(purchase.created_at).toLocaleDateString("en-NG", {
                      dateStyle: "medium",
                    })}
                    {" · "}
                    {money(purchase.amount_kobo / 100)}
                  </p>
                </div>
                <span className="status-pill">{purchase.status}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No payments have been made on this account.</p>
        )}
      </section>
    </>
  );
}
