import { useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Search,
  Heart,
  MapPin,
  BedDouble,
  Bath,
  Maximize,
  Menu,
  X,
  LogOut,
  BadgeCheck,
  Video,
} from "lucide-react";
import { api, money, type Property } from "./api";
import { hero } from "./demo";
import { useAuth } from "./auth";

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      {children}
    </div>
  );
}
export function Header({ overlay = false }: { overlay?: boolean }) {
  const { user, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <header className={`header ${overlay ? "overlay" : ""}`}>
      <Link className="logo" to="/" aria-label="NOMA home">
        NOMA<span>®</span>
      </Link>
      <button
        className="icon-button mobile-menu"
        onClick={() => setOpen(!open)}
        aria-label="Toggle navigation"
        aria-expanded={open}
      >
        {open ? <X /> : <Menu />}
      </button>
      <nav className={open ? "open" : ""} onClick={() => setOpen(false)}>
        <NavLink to="/discover">Discover</NavLink>
        <NavLink to="/properties?listing_type=rent">Rent</NavLink>
        {user && <NavLink to="/dashboard/new">List property</NavLink>}
      </nav>
      <div className="header-actions">
        {user ? (
          <>
            <Link
              className="icon-button"
              to="/saved"
              aria-label="Saved properties"
            >
              <Heart size={19} />
            </Link>
            <Link to="/account" className="sign-in">
              Hi, {user.first_name}
            </Link>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                await api("/auth/logout", { method: "POST" });
                await refresh();
                navigate("/");
              }}
            >
              <LogOut size={17} />
            </button>
          </>
        ) : (
          <Link className="sign-in" to="/login">
            Sign in / Log in
          </Link>
        )}
      </div>
    </header>
  );
}
export function Footer() {
  const { user } = useAuth();
  return (
    <footer>
      <div>
        <Link className="logo" to="/">
          NOMA<span>®</span>
        </Link>
        <p>
          Real people. Real spaces.
          <br />A place to call yours.
        </p>
      </div>
      <div className="footer-links">
        <Link to="/discover">Discover properties</Link>
        <Link to="/properties?listing_type=rent">Find a rental</Link>
        {user && <Link to="/dashboard/new">List your property</Link>}
        {user && <Link to="/account">Your profile</Link>}
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} NOMA. Made for your next chapter.
        </span>
        <span>
          Nigeria <span className="green-dot" />
        </span>
      </div>
    </footer>
  );
}
export function SearchBar({ initial = false }: { initial?: boolean }) {
  const [params] = useSearchParams();
  const type = "rent";
  const navigate = useNavigate();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const query = new URLSearchParams({ listing_type: type });
    for (const [key, value] of data)
      if (String(value)) query.set(key, String(value));
    navigate(`/properties?${query}`);
  }
  return (
    <form
      onSubmit={submit}
      className={initial ? "search-wrap" : "search-wrap compact"}
    >
      {initial && (
        <div className="search-tabs single">
          <button type="button" className="active">
            Rent
          </button>
        </div>
      )}
      <div className="search-bar">
        <label className="location-input">
          <Search size={20} />
          <input
            name="q"
            aria-label="Location or property"
            placeholder="Where do you want to live?"
            defaultValue={params.get("q") || ""}
          />
        </label>
        <label>
          <span>Property type</span>
          <select
            name="property_type"
            defaultValue={params.get("property_type") || ""}
          >
            <option value="">Any type</option>
            {[
              "apartment",
              "house",
              "duplex",
              "land",
              "commercial",
              "office",
            ].map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Max. price</span>
          <select name="max_price" defaultValue={params.get("max_price") || ""}>
            <option value="">Any price</option>
            {[2000000, 5000000, 10000000, 50000000, 100000000, 250000000].map(
              (p) => (
                <option value={p} key={p}>
                  {money(p)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          <span>Bedrooms</span>
          <select
            name="min_bedrooms"
            defaultValue={params.get("min_bedrooms") || ""}
          >
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </label>
        <button className="search-submit" aria-label="Search properties">
          <ArrowRight size={22} />
          <span>Search</span>
        </button>
      </div>
    </form>
  );
}
export function PropertyCard({
  property: p,
  saved = false,
  onSave,
}: {
  property: Property;
  saved?: boolean;
  onSave?: (p: Property) => void;
}) {
  const preview = p.id.startsWith("preview");
  return (
    <article className="property-card">
      <div className="card-image">
        <Link to={preview ? "/properties" : `/properties/${p.slug}`}>
          <img
            src={p.cover_image || p.images?.[0]?.url || hero}
            alt={p.title}
            loading="lazy"
          />
        </Link>
        <span className="listing-badge">
          {p.listing_type === "sale"
            ? "For sale"
            : p.listing_type === "rent"
              ? "For rent"
              : "Short let"}
        </span>
        <div className="media-badges">
          {p.is_featured && <span>Featured</span>}
          {p.is_verified && (
            <span>
              <BadgeCheck size={13} /> Verified
            </span>
          )}
          {p.has_video && (
            <span>
              <Video size={13} /> Video
            </span>
          )}
        </div>
        <button
          className={`save-button ${saved ? "saved" : ""}`}
          aria-label={saved ? "Remove from saved properties" : "Save property"}
          onClick={() => onSave?.(p)}
        >
          <Heart size={22} fill={saved ? "currentColor" : "none"} />
        </button>
        {preview && <span className="preview-label">Sample listing</span>}
      </div>
      <Link
        className="card-copy"
        to={preview ? "/properties" : `/properties/${p.slug}`}
      >
        <div className="card-price">
          {money(p.price)}
          {p.rental_period && <span> / {p.rental_period}</span>}
        </div>
        <h3>{p.title}</h3>
        <p className="card-location">
          <MapPin size={12} />
          {p.area ? `${p.area}, ` : ""}
          {p.city}
        </p>
        <div className="card-stats">
          <span>
            <BedDouble />
            {p.bedrooms ?? "—"} beds
          </span>
          <span>
            <Bath />
            {p.bathrooms ?? "—"} baths
          </span>
          <span>
            <Maximize />
            {p.size_sqm ?? "—"} sqm
          </span>
        </div>
      </Link>
    </article>
  );
}
