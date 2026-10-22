import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  Download,
  LockKeyhole,
  Trash2,
  UserRound,
} from "lucide-react";
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
    "profile" | "password" | "notifications" | "export" | "close" | null
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

  async function exportData() {
    setBusy("export");
    setError("");
    try {
      const data = await api<Record<string, unknown>>("/account/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `noma-account-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function closeAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("close");
    setError("");
    try {
      await api("/account", {
        method: "DELETE",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      await refresh();
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
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
        <section>
          <Download size={24} />
          <h2>Your data</h2>
          <p className="muted">
            Download a JSON copy of your account, listings, saved properties,
            inquiries, inspections, reviews, billing history and notifications.
          </p>
          <button
            className="button outline"
            onClick={() => void exportData()}
            disabled={busy !== null}
          >
            {busy === "export" ? "Preparing…" : "Download my data"}
            <Download size={15} />
          </button>
        </section>
      </div>
      {user.role !== "admin" && (
        <section className="danger-zone">
          <Trash2 size={24} />
          <h2>Close your account</h2>
          <p className="muted">
            This signs out every device, removes your listings from discovery,
            unlinks sign-in providers and anonymizes your personal details. This
            cannot be undone.
          </p>
          <form onSubmit={closeAccount}>
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
            <label>
              Type CLOSE MY ACCOUNT
              <input
                name="confirmation"
                required
                pattern="CLOSE MY ACCOUNT"
                autoComplete="off"
              />
            </label>
            <button className="button danger" disabled={busy !== null}>
              {busy === "close" ? "Closing…" : "Permanently close account"}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
