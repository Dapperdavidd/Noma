import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api, money, type Location } from "./api";
import { Notice } from "./components";

type Amenity = { id: string; name: string };

const FILTER_KEYS = [
  "state_id",
  "city_id",
  "area_id",
  "min_price",
  "max_price",
  "min_bedrooms",
  "max_bedrooms",
  "amenities",
];

export function PropertyFilters() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [error, setError] = useState("");
  const [stateId, setStateId] = useState(params.get("state_id") || "");
  const [cityId, setCityId] = useState(params.get("city_id") || "");
  const [selectedAmenities, setSelectedAmenities] = useState(
    () => new Set((params.get("amenities") || "").split(",").filter(Boolean)),
  );
  const filterKey = FILTER_KEYS.map((key) => params.get(key) || "").join("|");

  useEffect(() => {
    Promise.all([api<Location[]>("/locations"), api<Amenity[]>("/amenities")])
      .then(([nextLocations, nextAmenities]) => {
        setLocations(nextLocations);
        setAmenities(nextAmenities);
      })
      .catch((nextError) => setError(nextError.message));
  }, []);

  useEffect(() => {
    setStateId(params.get("state_id") || "");
    setCityId(params.get("city_id") || "");
    setSelectedAmenities(
      new Set((params.get("amenities") || "").split(",").filter(Boolean)),
    );
  }, [filterKey]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectedState = locations.find((state) => state.id === stateId);
  const selectedCity = selectedState?.cities.find((city) => city.id === cityId);
  const activeCount = useMemo(
    () => FILTER_KEYS.filter((key) => params.has(key)).length,
    [params],
  );

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = new URLSearchParams(params);
    for (const key of FILTER_KEYS) next.delete(key);
    for (const key of FILTER_KEYS.slice(0, -1)) {
      const value = String(values.get(key) || "");
      if (value) next.set(key, value);
    }
    if (selectedAmenities.size)
      next.set("amenities", [...selectedAmenities].join(","));
    next.delete("cursor");
    setParams(next);
    setOpen(false);
  }

  function clear() {
    const next = new URLSearchParams(params);
    for (const key of FILTER_KEYS) next.delete(key);
    next.delete("cursor");
    setStateId("");
    setCityId("");
    setSelectedAmenities(new Set());
    setParams(next);
    setOpen(false);
  }

  return (
    <div className="filter-shell">
      <button
        className="button outline filter-toggle"
        type="button"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={16} /> More filters
        {activeCount > 0 && <span>{activeCount}</span>}
      </button>
      {open && (
        <div
          className="filter-overlay"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <section
            className="filter-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="filter-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="filter-heading">
              <div>
                <div className="eyebrow">FIND WHAT FEELS RIGHT</div>
                <h2 id="filter-title">Refine your search.</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close filters"
                onClick={() => setOpen(false)}
              >
                <X />
              </button>
            </div>
            {error && <Notice>{error}</Notice>}
            <form onSubmit={apply}>
              <fieldset>
                <legend>Location</legend>
                <div className="filter-row">
                  <label>
                    State
                    <select
                      name="state_id"
                      value={stateId}
                      onChange={(event) => {
                        setStateId(event.target.value);
                        setCityId("");
                      }}
                    >
                      <option value="">Any state</option>
                      {locations.map((state) => (
                        <option value={state.id} key={state.id}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    City
                    <select
                      name="city_id"
                      value={cityId}
                      disabled={!stateId}
                      onChange={(event) => setCityId(event.target.value)}
                    >
                      <option value="">Any city</option>
                      {selectedState?.cities.map((city) => (
                        <option value={city.id} key={city.id}>
                          {city.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Area
                    <select
                      name="area_id"
                      key={cityId}
                      disabled={!cityId}
                      defaultValue={params.get("area_id") || ""}
                    >
                      <option value="">Any area</option>
                      {selectedCity?.areas.map((area) => (
                        <option value={area.id} key={area.id}>
                          {area.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>
              <fieldset>
                <legend>Budget</legend>
                <div className="filter-row two">
                  <label>
                    Minimum price
                    <select
                      name="min_price"
                      defaultValue={params.get("min_price") || ""}
                    >
                      <option value="">No minimum</option>
                      {[
                        1_000_000, 2_000_000, 5_000_000, 10_000_000, 25_000_000,
                        50_000_000, 100_000_000,
                      ].map((price) => (
                        <option value={price} key={price}>
                          {money(price)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Maximum price
                    <select
                      name="max_price"
                      defaultValue={params.get("max_price") || ""}
                    >
                      <option value="">No maximum</option>
                      {[
                        2_000_000, 5_000_000, 10_000_000, 25_000_000,
                        50_000_000, 100_000_000, 250_000_000, 500_000_000,
                      ].map((price) => (
                        <option value={price} key={price}>
                          {money(price)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>
              <fieldset>
                <legend>Bedrooms</legend>
                <div className="filter-row two">
                  <label>
                    Minimum bedrooms
                    <select
                      name="min_bedrooms"
                      defaultValue={params.get("min_bedrooms") || ""}
                    >
                      <option value="">No minimum</option>
                      {[1, 2, 3, 4, 5, 6].map((count) => (
                        <option value={count} key={count}>
                          {count}+
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Maximum bedrooms
                    <select
                      name="max_bedrooms"
                      defaultValue={params.get("max_bedrooms") || ""}
                    >
                      <option value="">No maximum</option>
                      {[1, 2, 3, 4, 5, 6].map((count) => (
                        <option value={count} key={count}>
                          Up to {count}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>
              <fieldset>
                <legend>Amenities</legend>
                <div className="filter-amenities">
                  {amenities.map((amenity) => {
                    const checked = selectedAmenities.has(amenity.id);
                    return (
                      <label
                        className={checked ? "selected" : ""}
                        key={amenity.id}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const next = new Set(selectedAmenities);
                            if (event.target.checked) next.add(amenity.id);
                            else next.delete(amenity.id);
                            setSelectedAmenities(next);
                          }}
                        />
                        <span>{amenity.name}</span>
                        {checked && <Check size={15} />}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="filter-actions">
                <button
                  className="button outline"
                  type="button"
                  onClick={clear}
                >
                  Clear filters
                </button>
                <button className="button olive" type="submit">
                  Show properties
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
