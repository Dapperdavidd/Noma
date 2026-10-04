import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { api, type Property } from "../api";
import { Header, Footer, Notice, SearchBar, PropertyCard } from "../components";
import { useFavorites } from "../favorites";
import { PropertyFilters } from "../filters";

export function Browse({ discover = false }: { discover?: boolean }) {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Property[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const favorites = useFavorites();
  const key = params.toString();
  const requestKey =
    discover && !params.has("sort")
      ? `${key}${key ? "&" : ""}sort=featured`
      : key;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api<{ data: Property[]; next_cursor: string | null }>(
      `/properties?${requestKey}`,
    )
      .then((v) => {
        if (active) {
          setItems(v.data);
          setCursor(v.next_cursor);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [requestKey]);
  async function more() {
    setLoadingMore(true);
    try {
      const p = new URLSearchParams(params);
      if (cursor) p.set("cursor", cursor);
      const v = await api<{ data: Property[]; next_cursor: string | null }>(
        `/properties?${p}`,
      );
      setItems((old) => [...old, ...v.data]);
      setCursor(v.next_cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <>
      <Header />
      <main className="section browse">
        <div className="eyebrow">
          {discover ? "DISCOVER REAL SPACES" : "MAKE YOURSELF AT HOME"}
        </div>
        <h1>
          {discover
            ? "Explore every published property."
            : "Find your next chapter."}
        </h1>
        {discover && (
          <p className="intro">
            New, featured and verified rentals from people across Nigeria.
          </p>
        )}
        <SearchBar key={key} />
        <div className="results-toolbar">
          <span className="result-count">
            {busy
              ? "Searching…"
              : `${items.length} ${items.length === 1 ? "property" : "properties"}${cursor ? " and more" : ""}`}
          </span>
          <div className="result-controls">
            <PropertyFilters />
            <label className="sort">
              <SlidersHorizontal size={16} />
              <select
                aria-label="Sort properties"
                value={params.get("sort") || (discover ? "featured" : "newest")}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  next.set("sort", e.target.value);
                  next.delete("cursor");
                  setParams(next);
                }}
              >
                <option value="newest">Newest first</option>
                <option value="featured">Featured and verified</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </label>
          </div>
        </div>
        {error && (
          <Notice>
            {error} Check that the API is running, then try again.
          </Notice>
        )}
        {favorites.error && <Notice>{favorites.error}</Notice>}
        {busy ? (
          <div className="skeleton-grid">
            {[1, 2, 3, 4].map((i) => (
              <div className="skeleton" key={i} />
            ))}
          </div>
        ) : (
          <div className="property-grid">
            {items.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                saved={favorites.ids.includes(p.id)}
                onSave={favorites.toggle}
              />
            ))}
          </div>
        )}
        {!busy && !error && !items.length && (
          <div className="empty">
            <Building2 size={42} />
            <h2>A little room for possibility.</h2>
            <p>
              No published properties match this search yet. Try another
              location or broaden your filters.
            </p>
            <Link
              className="button olive"
              to={discover ? "/discover" : "/properties"}
            >
              Clear filters <ArrowRight size={16} />
            </Link>
          </div>
        )}
        {cursor && (
          <button
            className="button outline load-more"
            disabled={loadingMore}
            onClick={more}
          >
            {loadingMore ? "Loading…" : "Show more properties"}
            <ChevronDown size={16} />
          </button>
        )}
      </main>
      <Footer />
    </>
  );
}
