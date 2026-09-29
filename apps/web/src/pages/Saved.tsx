import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Heart } from "lucide-react";
import { api, type Property } from "../api";
import { Notice, PropertyCard } from "../components";
import { useFavorites } from "../favorites";

export function Saved() {
  const favorites = useFavorites();
  const [items, setItems] = useState<Property[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      const found = await api<{
        data: Property[];
        next_cursor: string | null;
      }>("/favorites/properties");
      if (active) {
        setItems(found.data);
        setCursor(found.next_cursor);
      }
    }
    if (favorites.ids.length) void load().catch((e) => setError(e.message));
    else {
      setItems([]);
      setCursor(null);
    }
    return () => {
      active = false;
    };
  }, [favorites.ids]);
  async function showMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await api<{
        data: Property[];
        next_cursor: string | null;
      }>(`/favorites/properties?cursor=${encodeURIComponent(cursor)}`);
      setItems((current) => [...current, ...page.data]);
      setCursor(page.next_cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <>
      <div className="eyebrow">KEEP THE POSSIBILITIES CLOSE</div>
      <h1>Your saved spaces.</h1>
      {(error || favorites.error) && (
        <Notice>{error || favorites.error}</Notice>
      )}
      <div className="property-grid">
        {items.map((p) => (
          <PropertyCard
            key={p.id}
            property={p}
            saved
            onSave={favorites.toggle}
          />
        ))}
      </div>
      {cursor && (
        <button
          className="button ghost load-more"
          onClick={() => void showMore()}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading…" : "Show more saved properties"}
        </button>
      )}
      {!favorites.ids.length && (
        <div className="empty">
          <Heart size={40} />
          <h2>Something will feel right.</h2>
          <p>Tap the heart on a property to keep it here.</p>
          <Link to="/properties" className="button olive">
            Explore properties <ArrowRight size={16} />
          </Link>
        </div>
      )}
    </>
  );
}
