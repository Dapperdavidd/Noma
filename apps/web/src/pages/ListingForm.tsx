import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { api, type Property, type Location } from "../api";
import { Notice } from "../components";

export function ListingForm() {
  const { slug } = useParams();
  const [locations, setLocations] = useState<Location[]>([]);
  const [p, setP] = useState<Property | null>(null);
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [type, setType] = useState("sale");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    api<Location[]>("/locations")
      .then(setLocations)
      .catch((e) => setError(e.message));
    if (slug)
      api<Property>(`/properties/${slug}`)
        .then((v) => {
          setP(v);
          setState(v.state_id || "");
          setCity(v.city_id || "");
          setType(v.listing_type);
        })
        .catch((e) => setError(e.message));
  }, [slug]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const body = {
      ...values,
      price: Number(values.price),
      bedrooms: values.bedrooms ? Number(values.bedrooms) : null,
      bathrooms: values.bathrooms ? Number(values.bathrooms) : null,
      size_sqm: values.size_sqm ? Number(values.size_sqm) : null,
      area_id: values.area_id || null,
      rental_period: type === "sale" ? null : values.rental_period,
      images: String(values.images)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      await api(p ? `/properties/${p.id}` : "/properties", {
        method: p ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      navigate("/dashboard");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selectedState = locations.find((s) => s.id === state);
  const selectedCity = selectedState?.cities.find((c) => c.id === city);
  if (slug && !p) return <Notice>{error || "Loading property…"}</Notice>;
  return (
    <>
      <Link to="/dashboard" className="text-link">
        <ArrowLeft size={15} /> Your dashboard
      </Link>
      <div className="form-intro">
        <div className="eyebrow">MAKE A GREAT FIRST IMPRESSION</div>
        <h1>{p ? "Refine your listing." : "Let’s open some doors."}</h1>
        <p className="muted">
          New properties are saved as drafts. You can publish them from your
          dashboard.
        </p>
      </div>
      <form className="listing-form" onSubmit={submit}>
        <section>
          <h2>
            01 <span>The essentials</span>
          </h2>
          <label>
            Property title
            <input
              name="title"
              minLength={5}
              maxLength={200}
              required
              defaultValue={p?.title}
              placeholder="e.g. A bright 3-bedroom apartment in Ikoyi"
            />
          </label>
          <div className="form-row">
            <label>
              Listing type
              <select
                name="listing_type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="sale">For sale</option>
                <option value="rent">For rent</option>
                <option value="short_let">Short let</option>
              </select>
            </label>
            <label>
              Property type
              <select name="property_type" defaultValue={p?.property_type}>
                {[
                  "apartment",
                  "house",
                  "duplex",
                  "land",
                  "commercial",
                  "office",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Description
            <textarea
              name="description"
              rows={6}
              minLength={30}
              maxLength={20000}
              required
              defaultValue={p?.description}
              placeholder="Tell people what makes this space special. Include important details about condition, access and fees."
            />
          </label>
          <div className="form-row">
            <label>
              Price (₦)
              <input
                type="number"
                name="price"
                min="1"
                max="9007199254740991"
                step="1"
                required
                defaultValue={p?.price}
              />
            </label>
            {type !== "sale" && (
              <label>
                Rental period
                <select
                  name="rental_period"
                  defaultValue={p?.rental_period || "year"}
                >
                  <option value="year">Per year</option>
                  <option value="month">Per month</option>
                  <option value="day">Per day</option>
                </select>
              </label>
            )}
          </div>
          <div className="form-row three">
            {[
              ["bedrooms", "Bedrooms"],
              ["bathrooms", "Bathrooms"],
              ["size_sqm", "Size (sqm)"],
            ].map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  name={name}
                  type="number"
                  min={name === "size_sqm" ? 1 : 0}
                  max={name === "size_sqm" ? 10000000 : 100}
                  defaultValue={
                    p?.[name as "bedrooms" | "bathrooms" | "size_sqm"] ?? ""
                  }
                />
              </label>
            ))}
          </div>
        </section>
        <section>
          <h2>
            02 <span>A place on the map</span>
          </h2>
          <div className="form-row">
            <label>
              State
              <select
                name="state_id"
                required
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setCity("");
                }}
              >
                <option value="">Select state</option>
                {locations.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              City
              <select
                name="city_id"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
              >
                <option value="">Select city</option>
                {selectedState?.cities.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Area
            <select name="area_id" key={city} defaultValue={p?.area_id || ""}>
              <option value="">Select area (optional)</option>
              {selectedCity?.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Street address
            <input
              name="address"
              required
              maxLength={500}
              defaultValue={p?.address}
            />
          </label>
        </section>
        <section>
          <h2>
            03 <span>Show the space</span>
          </h2>
          <p className="muted">
            Add HTTPS image links from your storage provider, one per line. The
            first photo becomes the cover. Up to 20 photos.
          </p>
          <label>
            Property image URLs
            <textarea
              name="images"
              rows={5}
              required
              defaultValue={p?.images?.map((i) => i.url).join("\n")}
              placeholder="https://your-image-provider.com/property-front.jpg"
            />
          </label>
          <p className="fine-print">
            Direct file uploads will be available once the image storage account
            is connected.
          </p>
        </section>
        {error && <Notice>{error}</Notice>}
        <div className="form-actions">
          <Link className="button outline" to="/dashboard">
            Cancel
          </Link>
          <button className="button olive" disabled={busy}>
            {busy ? "Saving…" : p ? "Save changes" : "Save draft"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </>
  );
}
