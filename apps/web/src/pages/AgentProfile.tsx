import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, BadgeCheck, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { Notice } from "../components";

type Profile = {
  agency_name: string | null;
  bio: string | null;
  license_number: string | null;
  years_experience: number | null;
  service_areas: string[];
  website_url: string | null;
  profile_image_url: string | null;
  verification_status: "unsubmitted" | "pending" | "verified" | "rejected";
};

const statusCopy = {
  unsubmitted: "Ready when your profile is complete",
  pending: "Application under review",
  verified: "NOMA verified agent",
  rejected: "Application needs changes",
};

export function AgentProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setProfile(await api<Profile>("/agent/profile"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      const years = String(data.years_experience || "").trim();
      await api("/agent/profile", {
        method: "PUT",
        body: JSON.stringify({
          ...data,
          years_experience: years ? Number(years) : null,
          service_areas: String(data.service_areas || "")
            .split(/[,\n]/)
            .map((area) => area.trim())
            .filter(Boolean),
        }),
      });
      await load();
      setMessage("Your professional profile has been saved.");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api("/agent/verification", {
        method: "POST",
        body: JSON.stringify({ declaration: true }),
      });
      await load();
      setMessage("Your verification application has been submitted.");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link className="text-link" to="/dashboard">
        <ArrowLeft size={16} />
        Your dashboard
      </Link>
      <div className="form-intro">
        <div className="eyebrow">THE PERSON BEHIND THE PROPERTY</div>
        <h1>Your agent profile.</h1>
        <p className="muted">
          Give customers enough context to decide who they want to inspect a
          home with.
        </p>
      </div>
      {error && <Notice>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {profile && (
        <>
          <div
            className={`verification-summary ${profile.verification_status}`}
          >
            {profile.verification_status === "verified" ? (
              <BadgeCheck size={22} />
            ) : (
              <ShieldCheck size={22} />
            )}
            <div>
              <strong>{statusCopy[profile.verification_status]}</strong>
              <span>
                {profile.verification_status === "pending"
                  ? "We will keep your current application unchanged while it is reviewed."
                  : "Verification is reviewed by NOMA and is separate from customer ratings."}
              </span>
            </div>
          </div>
          <form className="listing-form agent-profile-form" onSubmit={submit}>
            <section>
              <h2>Public profile</h2>
              <div className="form-grid two">
                <label>
                  Agency or business name
                  <input
                    name="agency_name"
                    maxLength={200}
                    required
                    defaultValue={profile.agency_name || ""}
                  />
                </label>
                <label>
                  Years of experience
                  <input
                    name="years_experience"
                    type="number"
                    min={0}
                    max={80}
                    defaultValue={profile.years_experience ?? ""}
                  />
                </label>
                <label>
                  Professional licence or registration number
                  <input
                    name="license_number"
                    maxLength={120}
                    defaultValue={profile.license_number || ""}
                  />
                </label>
                <label>
                  Website
                  <input
                    name="website_url"
                    type="url"
                    placeholder="https://example.com"
                    defaultValue={profile.website_url || ""}
                  />
                </label>
              </div>
              <label>
                Service areas
                <textarea
                  name="service_areas"
                  rows={3}
                  placeholder="Lekki, Ikeja, Abuja"
                  defaultValue={profile.service_areas.join(", ")}
                />
                <small>Separate each city or neighbourhood with a comma.</small>
              </label>
              <label>
                Profile photo URL
                <input
                  name="profile_image_url"
                  type="url"
                  placeholder="https://..."
                  defaultValue={profile.profile_image_url || ""}
                />
              </label>
              <label>
                About you
                <textarea
                  name="bio"
                  maxLength={3000}
                  minLength={40}
                  rows={7}
                  required
                  defaultValue={profile.bio || ""}
                />
                <small>
                  Include your markets, experience and how you support clients.
                </small>
              </label>
            </section>
            {(profile.verification_status === "pending" ||
              profile.verification_status === "verified") && (
              <Notice>
                Saving changes withdraws the current verification state so the
                updated information can be reviewed again.
              </Notice>
            )}
            <button className="button olive" disabled={busy}>
              {busy ? "Saving…" : "Save professional profile"}
              <ArrowRight size={16} />
            </button>
          </form>
          {profile.verification_status !== "pending" &&
            profile.verification_status !== "verified" && (
              <form className="verification-application" onSubmit={apply}>
                <div>
                  <div className="eyebrow">APPLY FOR VERIFICATION</div>
                  <h2>Build trust with a reviewed profile.</h2>
                  <p className="muted">
                    Complete and save your profile first. NOMA reviews the
                    information you submit before showing a verification badge.
                  </p>
                </div>
                <label className="checkbox-label">
                  <input type="checkbox" required />
                  <span>
                    I confirm that the professional information in this profile
                    is accurate and belongs to me or my agency.
                  </span>
                </label>
                <button className="button ghost" disabled={busy}>
                  Submit for verification
                  <ShieldCheck size={16} />
                </button>
              </form>
            )}
        </>
      )}
    </>
  );
}
