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
  AlertTriangle,
  Check,
  PlayCircle,
  Send,
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
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
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
  async function report(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setReporting(true);
    try {
      await api(`/properties/${p!.id}/reports`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      setReported(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReporting(false);
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
            {p.videos && p.videos.length > 0 && (
              <section className="property-videos">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">WATCH THE WALKTHROUGH</div>
                    <h2>See the space in motion.</h2>
                  </div>
                  <PlayCircle size={28} />
                </div>
                <div className="video-grid">
                  {p.videos.map((video, index) => (
                    <PropertyVideo
                      key={video.id || video.url}
                      url={video.url}
                      title={`${p.title} video ${index + 1}`}
                    />
                  ))}
                </div>
              </section>
            )}
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
                {p.agent?.whatsapp && (
                  <a
                    className="button whatsapp full"
                    href={`https://wa.me/${p.agent.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello, I’m interested in ${p.title} on NOMA.`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Contact on WhatsApp <MessageCircle size={17} />
                  </a>
                )}
                <div className="social-contact-links">
                  {p.agent?.telegram && (
                    <a
                      className="text-link"
                      href={`https://t.me/${p.agent.telegram.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Telegram <Send size={14} />
                    </a>
                  )}
                  {p.agent?.instagram && (
                    <a
                      className="text-link"
                      href={`https://instagram.com/${p.agent.instagram.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Instagram <ArrowRight size={14} />
                    </a>
                  )}
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
                {user && user.id !== p.agent?.id && (
                  <details className="report-property">
                    <summary>
                      <AlertTriangle size={14} /> Report this listing
                    </summary>
                    {reported ? (
                      <Notice>
                        Report received. An administrator will review it.
                      </Notice>
                    ) : (
                      <form onSubmit={report}>
                        <label>
                          What seems wrong?
                          <select name="category" defaultValue="inaccurate">
                            <option value="suspected_scam">
                              Suspected scam
                            </option>
                            <option value="duplicate">Duplicate listing</option>
                            <option value="inaccurate">
                              Inaccurate information
                            </option>
                            <option value="unavailable">
                              Property is unavailable
                            </option>
                            <option value="other">Something else</option>
                          </select>
                        </label>
                        <label>
                          Details
                          <textarea
                            name="details"
                            required
                            minLength={10}
                            maxLength={2000}
                            placeholder="Tell the review team what you noticed."
                          />
                        </label>
                        <button
                          className="button outline full"
                          disabled={reporting}
                        >
                          {reporting ? "Sending…" : "Send report"}
                        </button>
                      </form>
                    )}
                  </details>
                )}
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

function youtubeId(url: string) {
  try {
    const parsed = new URL(url);
    const id =
      parsed.hostname === "youtu.be"
        ? parsed.pathname.slice(1)
        : parsed.searchParams.get("v") || parsed.pathname.split("/embed/")[1];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function PropertyVideo({ url, title }: { url: string; title: string }) {
  const id = youtubeId(url);
  return id ? (
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${id}`}
      title={title}
      loading="lazy"
      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  ) : (
    <video src={url} controls preload="metadata" aria-label={title} />
  );
}
