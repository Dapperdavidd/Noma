import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bell, LockKeyhole, UserRound } from "lucide-react";
import { api, type User } from "../api";
import { useAuth } from "../auth";
import { Notice } from "../components";

export function Account() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [profileSaved, setProfileSaved] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  const [emailActivity, setEmailActivity] = useState(true);
  const [verificationSent, setVerificationSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<
    "profile" | "password" | "notifications" | null
  >(null);

  useEffect(() => {
    api<{ email_activity: boolean }>("/notifications/preferences")
      .then((preferences) => setEmailActivity(preferences.email_activity))
      .catch((e) => setError(e.message));
  }, []);

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("profile");
    setError("");
    setProfileSaved(false);
    try {
      await api<User>("/account/profile", {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      await refresh();
      setProfileSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("password");
    setError("");
    try {
      await api("/account/password", {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      await refresh();
      navigate("/login", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function resendVerification() {
    setBusy("profile");
    setError("");
    try {
      await api("/auth/verify-email/resend", { method: "POST" });
      setVerificationSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveNotifications(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("notifications");
    setError("");
    setPreferencesSaved(false);
    try {
      await api("/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({ email_activity: emailActivity }),
      });
      setPreferencesSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!user) return null;
  return (
    <>
      <div className="eyebrow">YOUR NOMA ACCOUNT</div>
      <div className="section-heading account-heading">
        <div>
          <h1>Keep your details current.</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
        <Link className="text-link" to="/dashboard">
          Property dashboard <ArrowRight size={15} />
        </Link>
      </div>
      {error && <Notice>{error}</Notice>}
      {profileSaved && <Notice>Your account details have been updated.</Notice>}
      {preferencesSaved && (
        <Notice>Your notification preferences have been updated.</Notice>
      )}
      {!user.is_verified && (
        <Notice>
          Verify your email to secure account recovery.{" "}
          <button className="inline-action" onClick={resendVerification}>
            {verificationSent ? "Verification sent" : "Send a new link"}
          </button>
        </Notice>
      )}
      <div className="account-grid">
        <section>
          <UserRound size={24} />
          <h2>Personal details</h2>
          <form onSubmit={saveProfile}>
            <div className="form-row">
              <label>
                First name
                <input
                  name="first_name"
                  required
                  maxLength={100}
                  defaultValue={user.first_name}
                  autoComplete="given-name"
                />
              </label>
              <label>
                Last name
                <input
                  name="last_name"
                  required
                  maxLength={100}
                  defaultValue={user.last_name}
                  autoComplete="family-name"
                />
              </label>
            </div>
            <label>
              Phone number
              <input
                name="phone"
                type="tel"
                maxLength={30}
                defaultValue={user.phone || ""}
                autoComplete="tel"
                placeholder="+234 800 000 0000"
              />
            </label>
            <label>
              WhatsApp number
              <input
                name="whatsapp"
                type="tel"
                maxLength={30}
                defaultValue={user.whatsapp || ""}
                placeholder="+234 800 000 0000"
              />
            </label>
            <div className="form-row">
              <label>
                Telegram handle
                <input
                  name="telegram"
                  maxLength={65}
                  defaultValue={user.telegram || ""}
                  placeholder="@yourhandle"
                />
              </label>
              <label>
                Instagram handle
                <input
                  name="instagram"
                  maxLength={65}
                  defaultValue={user.instagram || ""}
                  placeholder="@yourhandle"
                />
              </label>
            </div>
            <p className="fine-print">
              WhatsApp is shown first on your published listings. Telegram and
              Instagram appear when you provide them.
            </p>
            <button className="button olive" disabled={busy !== null}>
              {busy === "profile" ? "Saving…" : "Save details"}
            </button>
          </form>
        </section>
        <section>
          <LockKeyhole size={24} />
          <h2>{user.has_password ? "Change password" : "Add a password"}</h2>
          <p className="muted">
            For your security, changing your password signs out every device.
          </p>
          <form onSubmit={changePassword}>
            {user.has_password && (
              <label>
                Current password
                <input
                  name="current_password"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
            )}
            {!user.has_password && (
              <input type="hidden" name="current_password" value="" />
            )}
            <label>
              New password
              <input
                name="new_password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                placeholder="At least 12 characters"
              />
            </label>
            <button className="button outline" disabled={busy !== null}>
              {busy === "password" ? "Updating…" : "Update password"}
            </button>
          </form>
        </section>
        <section>
          <Bell size={24} />
          <h2>Notifications</h2>
          <p className="muted">
            Important activity always appears inside NOMA. Choose whether to
            receive a matching email as well.
          </p>
          <form onSubmit={saveNotifications}>
            <label className="preference-toggle">
              <input
                type="checkbox"
                checked={emailActivity}
                onChange={(event) => setEmailActivity(event.target.checked)}
              />
              Email me about inquiries, inspections and reviews
            </label>
            <button className="button outline" disabled={busy !== null}>
              {busy === "notifications" ? "Saving…" : "Save notifications"}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
