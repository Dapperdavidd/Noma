import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  ShieldCheck,
  MessageCircle,
} from "lucide-react";
import { api, type Property } from "../api";
import { hero, samples } from "../demo";
import { Header, Footer, Notice, SearchBar, PropertyCard } from "../components";
import { useFavorites } from "../favorites";

export function Home() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loaded, setLoaded] = useState(false);
  const favorites = useFavorites();
  useEffect(() => {
    api<{ data: Property[] }>("/properties?limit=4")
      .then((v) => setProperties(v.data))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  const preview = loaded && properties.length === 0;
  return (
    <>
      <section
        className="hero"
        style={{
          backgroundImage: `linear-gradient(90deg,rgba(15,21,17,.63),rgba(15,21,17,.08)),linear-gradient(0deg,rgba(12,19,15,.55),transparent 65%),url(${hero})`,
        }}
      >
        <Header overlay />
        <div className="hero-content">
          <div className="eyebrow">MORE THAN JUST PROPERTIES</div>
          <h1>
            Find a place
            <br />
            that feels right.
          </h1>
          <p>
            Discover homes, apartments and spaces across Nigeria.
            <br className="desktop" /> Whether you’re buying, renting or
            starting a new
            <br className="desktop" /> chapter — we’ll help you feel at home.
          </p>
          <SearchBar initial />
        </div>
        <div className="hero-bottom">
          <span>
            <span className="tiny-line" /> SPACES FOR THE WAY YOU LIVE
          </span>
          <span>
            <MapPin size={13} /> Inspired by modern Nigerian living
          </span>
        </div>
      </section>
      <main>
        <section className="section featured">
          <div className="section-heading">
            <div>
              <div className="eyebrow">A PLACE FOR YOUR NEXT CHAPTER</div>
              <h2>
                Explore top listings<span className="olive-dot">.</span>
              </h2>
            </div>
            <Link className="text-link" to="/properties">
              Explore all properties <ArrowRight size={17} />
            </Link>
          </div>
          {favorites.error && <Notice>{favorites.error}</Notice>}
          <div className="property-grid">
            {(preview ? samples : properties).map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                saved={favorites.ids.includes(p.id)}
                onSave={favorites.toggle}
              />
            ))}
          </div>
          {!loaded && <p className="muted">Finding your next place…</p>}
          {preview && (
            <p className="sample-note">
              A glimpse of what’s possible. These are illustrative listings;
              live listings will appear here when published.
            </p>
          )}
        </section>
        <section className="listing-banner">
          <div className="banner-photo" />
          <div className="banner-title">
            <div className="eyebrow">OPEN THE DOOR TO OPPORTUNITY</div>
            <h2>
              More than a listing.
              <br />
              Your next beginning.
            </h2>
            <Link className="text-link" to="/join?role=agent">
              List with NOMA <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="banner-feature">
            <ShieldCheck />
            <h3>A foundation of trust</h3>
            <p>
              Clear listing details and separate agent and property
              verification.
            </p>
          </div>
          <div className="banner-feature">
            <MessageCircle />
            <h3>Real connections</h3>
            <p>
              Reach property owners and agents directly. Your next chapter
              starts with a conversation.
            </p>
          </div>
          <Link
            to="/join?role=agent"
            className="round-link"
            aria-label="Start listing"
          >
            <ArrowRight />
          </Link>
        </section>
        <section className="section neighborhoods">
          <div className="section-heading">
            <div>
              <div className="eyebrow">FIND YOUR EVERYDAY</div>
              <h2>A neighbourhood for you.</h2>
            </div>
            <p>
              City energy or a slower pace.
              <br />
              Find somewhere that feels like you.
            </p>
          </div>
          <div className="city-grid">
            {[
              [
                "Lagos",
                "By the water. At the heart of it all.",
                "photo-1618828665011-0abd973f7bb8",
              ],
              [
                "Abuja",
                "A little more room to breathe.",
                "photo-1600607687920-4e2a09cf159d",
              ],
              [
                "Port Harcourt",
                "New possibilities. Familiar warmth.",
                "photo-1600566753086-00f18fb6b3ea",
              ],
            ].map(([city, desc, img]) => (
              <Link
                to={`/properties?q=${encodeURIComponent(city)}`}
                className="city-card"
                key={city}
                style={{
                  backgroundImage: `linear-gradient(0deg,rgba(0,0,0,.65),transparent),url(https://images.unsplash.com/${img}?auto=format&fit=crop&w=800&q=80)`,
                }}
              >
                <span className="city-tag">EXPLORE THE CITY</span>
                <div>
                  <h3>{city}</h3>
                  <p>{desc}</p>
                </div>
                <ArrowUpRight />
              </Link>
            ))}
          </div>
          <p className="sample-note">
            Architectural imagery is illustrative of the NOMA aesthetic.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
