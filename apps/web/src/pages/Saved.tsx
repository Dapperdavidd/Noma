import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Heart } from "lucide-react";
import { api, type Property } from "../api";
import { Notice, PropertyCard } from "../components";
import { useFavorites } from "../favorites";

export function Saved() {
  const favorites = useFavorites();
  const [items, setItems] = useState<Property[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      const found = await api<Property[]>("/favorites/properties");
      if (active) setItems(found);
    }
    if (favorites.ids.length) void load().catch((e) => setError(e.message));
    else setItems([]);
    return () => {
      active = false;
    };
  }, [favorites.ids]);
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
