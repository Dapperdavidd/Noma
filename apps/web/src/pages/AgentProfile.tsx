import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "../api";
import { Notice } from "../components";
type Profile = {
  agency_name: string | null;
  bio: string | null;
  verification_status: string;
};
export function AgentProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Profile>("/agent/profile")
      .then(setProfile)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await api("/agent/profile", {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      setSaved(true);
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
          Help people get to know you. Profile changes return your verification
          to pending review.
        </p>
      </div>
      {error && <Notice>{error}</Notice>}
      {saved && <Notice>Your profile has been updated.</Notice>}
      {profile && (
        <form className="listing-form" onSubmit={submit}>
          <label>
            Agency name
            <input
              name="agency_name"
              maxLength={200}
              defaultValue={profile.agency_name || ""}
            />
          </label>
          <label>
            About you
            <textarea
              name="bio"
              maxLength={3000}
              rows={6}
              defaultValue={profile.bio || ""}
            />
          </label>
          <p className="muted">
            Verification: {saved ? "pending" : profile.verification_status}
          </p>
          <button className="button olive" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
            <ArrowRight size={16} />
          </button>
        </form>
      )}
    </>
  );
}
