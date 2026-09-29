import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  Heart,
  MapPin,
  BedDouble,
  Bath,
  Maximize,
  ShieldCheck,
  MessageCircle,
  Check,
} from "lucide-react";
import { api, money, type Property } from "../api";
import { hero } from "../demo";
import { Header, Footer, Notice } from "../components";
import { useAuth } from "../auth";
import { useFavorites } from "../favorites";

export function Detail() {
  const { slug } = useParams();
  const [p, setP] = useState<Property | null>(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState(0);
  const { user } = useAuth();
  const favorites = useFavorites();
  useEffect(() => {
    setP(null);
    setError("");
    api<Property>(`/properties/${slug}`)
      .then(setP)
      .catch((e) => setError(e.message));
  }, [slug]);
  async function inquire(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);
    try {
      await api(`/properties/${p!.id}/inquiries`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <Header />
      <main className="section detail">
        <Link to="/properties" className="text-link">
          <ArrowLeft size={16} /> Back to properties
        </Link>
        {error && <Notice>{error}</Notice>}
        {p ? (
          <>
            <div className="detail-heading">
              <div>
                <div className="eyebrow">
                  {p.listing_type === "sale"
                    ? "FOR SALE"
                    : p.listing_type === "rent"
                      ? "FOR RENT"
                      : "SHORT LET"}{" "}
                  · {p.property_type}
                </div>
                <h1>{p.title}</h1>
                <p className="muted">
                  <MapPin size={15} /> {p.area}, {p.city}, {p.state}
                </p>
              </div>
              <button
                className="button outline"
                onClick={() => favorites.toggle(p)}
              >
                <Heart
                  size={18}
                  fill={favorites.ids.includes(p.id) ? "currentColor" : "none"}
                />
                Save property
              </button>
            </div>
            {favorites.error && <Notice>{favorites.error}</Notice>}
            <div className="gallery">
              <img
                className="main-photo"
                src={p.images?.[selected]?.url || hero}
                alt={p.title}
              />
              {p.images && p.images.length > 1 && (
                <div className="thumbnails">
                  {p.images.map((image, i) => (
                    <button
                      key={image.url}
                      onClick={() => setSelected(i)}
                      aria-label={`View photo ${i + 1}`}
                      aria-pressed={selected === i}
                    >
                      <img src={image.url} alt={`Property view ${i + 1}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="detail-columns">
              <div>
                <div className="detail-stats">
                  <span>
                    <BedDouble />
                    {p.bedrooms ?? "—"} bedrooms
                  </span>
                  <span>
                    <Bath />
                    {p.bathrooms ?? "—"} bathrooms
                  </span>
                  <span>
                    <Maximize />
                    {p.size_sqm ?? "—"} sqm
                  </span>
                </div>
                <h2>A closer look.</h2>
                <p className="description">{p.description}</p>
                {p.amenities && p.amenities.length > 0 && (
                  <>
                    <h2>The little extras.</h2>
                    <div className="amenities">
                      {p.amenities.map((a) => (
                        <span key={a}>
                          <Check size={16} />
                          {a}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <h2>Location</h2>
                <p>{p.address}</p>
                <p className="muted">
                  {p.area}, {p.city}, {p.state}
                </p>
              </div>
              <aside className="contact-panel">
                <div className="card-price">
                  {money(p.price)}
                  {p.rental_period && <span> / {p.rental_period}</span>}
                </div>
                {p.is_verified && (
                  <p className="verified">
                    <ShieldCheck size={16} /> Property verified
                  </p>
                )}
                <hr />
                <div className="agent">
                  <div className="avatar">{p.agent?.first_name[0]}</div>
                  <div>
                    <strong>
                      {p.agent?.first_name} {p.agent?.last_name}
                    </strong>
                    <p>{p.agent?.agency_name || "Property agent"}</p>
                    {p.agent?.verification_status === "verified" && (
                      <small>Verified agent</small>
                    )}
                  </div>
                </div>
                {sent ? (
                  <Notice>
                    Your inquiry has been sent. The agent can now respond using
                    your account email.
                  </Notice>
                ) : user ? (
                  <form onSubmit={inquire}>
                    <label>
                      Your message
                      <textarea
                        name="message"
                        minLength={10}
                        maxLength={3000}
                        required
                        defaultValue="Hello, I’m interested in this property. Could we arrange a viewing?"
                      />
                    </label>
                    <button className="button olive full" disabled={sending}>
                      {sending ? "Sending…" : "Contact agent"}
                      <MessageCircle size={17} />
                    </button>
                  </form>
                ) : (
                  <Link className="button olive full" to="/login">
                    Sign in to contact agent <ArrowRight size={16} />
                  </Link>
                )}
                <p className="fine-print">
                  Visit the property and verify ownership before making a
                  payment.
                </p>
              </aside>
            </div>
          </>
        ) : (
          !error && <div className="skeleton" />
        )}
      </main>
      <Footer />
    </>
  );
}
