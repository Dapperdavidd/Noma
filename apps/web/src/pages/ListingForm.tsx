import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, ArrowLeft, X } from "lucide-react";
import { api, type Property, type Location } from "../api";
import { uploadPhoto, uploadVideo, type ManagedUpload } from "../uploads";
import { Notice } from "../components";
import { useAuth } from "../auth";

export function ListingForm() {
  const { user } = useAuth();
  const { slug } = useParams();
  const [amenities, setAmenities] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [p, setP] = useState<Property | null>(null);
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [type, setType] = useState("rent");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageUrls, setImageUrls] = useState("");
  const [managedImages, setManagedImages] = useState<ManagedUpload[]>([]);
  const [videoUrls, setVideoUrls] = useState("");
  const [managedVideos, setManagedVideos] = useState<ManagedUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const pendingUploads = useRef(new Set<string>());
  const navigate = useNavigate();
  useEffect(() => {
    api<{ id: string; name: string }[]>("/amenities")
      .then(setAmenities)
      .catch((e) => setError(e.message));
    api<Location[]>("/locations")
      .then(setLocations)
      .catch((e) => setError(e.message));
    if (slug)
      api<Property>(`/properties/${slug}`)
        .then((v) => {
          setP(v);
          setSelectedAmenities(v.amenity_ids || []);
          setImageUrls(v.images?.map((i) => i.url).join("\n") || "");
          setManagedImages(
            v.images
              ?.filter((image) => image.upload_id && image.public_id)
              .map((image) => ({
                upload_id: image.upload_id!,
                public_id: image.public_id!,
                url: image.url,
              })) || [],
          );
          setVideoUrls(v.videos?.map((video) => video.url).join("\n") || "");
          setManagedVideos(
            v.videos
              ?.filter((video) => video.upload_id && video.public_id)
              .map((video) => ({
                upload_id: video.upload_id!,
                public_id: video.public_id!,
                url: video.url,
              })) || [],
          );
          setState(v.state_id || "");
          setCity(v.city_id || "");
          setType(v.listing_type);
        })
        .catch((e) => setError(e.message));
  }, [slug]);
  useEffect(
    () => () => {
      for (const uploadId of pendingUploads.current) {
        void fetch(`/api/v1/images/uploads/${uploadId}`, {
          method: "DELETE",
          credentials: "include",
          keepalive: true,
        });
      }
    },
    [],
  );
  async function photos(files: FileList | null) {
    if (!files) return;
    const existing = imageUrls.split("\n").filter(Boolean);
    if (existing.length + files.length > 20) {
      setError("A listing can have up to 20 photos.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const image = await uploadPhoto(file);
        pendingUploads.current.add(image.upload_id);
        setManagedImages((old) => [...old, image]);
        setImageUrls((old) => (old ? `${old}\n${image.url}` : image.url));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function videos(files: FileList | null) {
    if (!files) return;
    const existing = videoUrls.split("\n").filter(Boolean);
    if (existing.length + files.length > 8) {
      setError("A listing can have up to 8 videos.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const video = await uploadVideo(file);
        pendingUploads.current.add(video.upload_id);
        setManagedVideos((old) => [...old, video]);
        setVideoUrls((old) => (old ? `${old}\n${video.url}` : video.url));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const imageValues = String(values.images)
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((url) => {
        const managed = managedImages.find((image) => image.url === url);
        return managed ? { upload_id: managed.upload_id, url } : url;
      });
    const videoValues = String(values.videos || "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((url) => {
        const managed = managedVideos.find((video) => video.url === url);
        return managed ? { upload_id: managed.upload_id, url } : url;
      });
    const body = {
      ...values,
      amenity_ids: selectedAmenities,
      price: Number(values.price),
      bedrooms: values.bedrooms ? Number(values.bedrooms) : null,
      bathrooms: values.bathrooms ? Number(values.bathrooms) : null,
      size_sqm: values.size_sqm ? Number(values.size_sqm) : null,
      area_id: values.area_id || null,
      rental_period: type === "sale" ? null : values.rental_period,
      images: imageValues,
      videos: videoValues,
    };
    try {
      await api(p ? `/properties/${p.id}` : "/properties", {
        method: p ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      const attached = new Set(
        [...imageValues, ...videoValues]
          .filter(
            (image): image is { upload_id: string; url: string } =>
              typeof image !== "string",
          )
          .map((image) => image.upload_id),
      );
      pendingUploads.current = new Set(
        [...pendingUploads.current].filter(
          (uploadId) => !attached.has(uploadId),
        ),
      );
      navigate("/dashboard");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selectedState = locations.find((s) => s.id === state);
  const selectedCity = selectedState?.cities.find((c) => c.id === city);
  const imageList = imageUrls
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);
  const videoList = videoUrls
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);
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
          {user?.role === "agent" || user?.role === "admin" ? (
            <label>
              Your relationship to this property
              <select
                name="lister_relationship"
                defaultValue={p?.lister_relationship || "authorized_agent"}
              >
                <option value="authorized_agent">
                  I am an agent authorized by the owner
                </option>
                <option value="owner">I own this property</option>
              </select>
              <span className="field-help">
                By publishing, you confirm you have permission to advertise this
                property.
              </span>
            </label>
          ) : (
            <input type="hidden" name="lister_relationship" value="owner" />
          )}
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
            Show what makes the space special. The first photo becomes the
            cover. Add up to 20 photos.
          </p>
          <label className="upload-zone">
            {uploading ? "Uploading photos…" : "Upload property photos"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              disabled={uploading}
              onChange={(e) => void photos(e.target.files)}
            />
            <span>JPEG, PNG, WebP or AVIF · Up to 10 MB each</span>
          </label>
          <label>
            Property image URLs
            <textarea
              name="images"
              rows={5}
              required
              value={imageUrls}
              onChange={(e) => setImageUrls(e.target.value)}
              placeholder="https://your-image-provider.com/property-front.jpg"
            />
          </label>
          {imageList.length > 0 && (
            <div
              className="listing-image-previews"
              aria-label="Property photos"
            >
              {imageList.map((url, index) => (
                <div key={`${url}-${index}`}>
                  <img src={url} alt={`Property preview ${index + 1}`} />
                  {index === 0 && <span>Cover photo</span>}
                  <button
                    type="button"
                    aria-label={`Remove property photo ${index + 1}`}
                    onClick={() =>
                      setImageUrls(
                        imageList
                          .filter((_, item) => item !== index)
                          .join("\n"),
                      )
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="fine-print">
            You can also paste existing image links, one per line.
          </p>
          <h2>Property videos</h2>
          <p className="muted">
            Upload walkthroughs or paste YouTube links. Add up to 8 videos.
          </p>
          <label className="upload-zone">
            {uploading ? "Uploading media…" : "Upload property videos"}
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              multiple
              disabled={uploading}
              onChange={(e) => void videos(e.target.files)}
            />
            <span>MP4, WebM or MOV · Up to 100 MB each</span>
          </label>
          <label>
            Video or YouTube URLs
            <textarea
              name="videos"
              rows={4}
              value={videoUrls}
              onChange={(e) => setVideoUrls(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </label>
          {videoList.length > 0 && (
            <div
              className="listing-video-previews"
              aria-label="Property videos"
            >
              {videoList.map((url, index) => (
                <div key={`${url}-${index}`}>
                  <VideoPreview
                    url={url}
                    title={`Property video ${index + 1}`}
                  />
                  <button
                    type="button"
                    aria-label={`Remove property video ${index + 1}`}
                    onClick={() =>
                      setVideoUrls(
                        videoList
                          .filter((_, item) => item !== index)
                          .join("\n"),
                      )
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <h2>Amenities</h2>
          <div className="amenity-picker">
            {amenities.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={selectedAmenities.includes(a.id)}
                  onChange={(e) =>
                    setSelectedAmenities((old) =>
                      e.target.checked
                        ? [...old, a.id]
                        : old.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
          </div>
        </section>
        {error && <Notice>{error}</Notice>}
        <div className="form-actions">
          <Link className="button outline" to="/dashboard">
            Cancel
          </Link>
          <button className="button olive" disabled={busy || uploading}>
            {busy ? "Saving…" : p ? "Save changes" : "Save draft"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
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

function VideoPreview({ url, title }: { url: string; title: string }) {
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
