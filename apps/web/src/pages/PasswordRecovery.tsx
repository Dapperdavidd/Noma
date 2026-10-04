import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import { Header, Notice } from "../components";
import { useAuth } from "../auth";

function AuthPage({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="auth-single">{children}</main>
    </>
  );
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      });
      setSent(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthPage>
      <div className="eyebrow">ACCOUNT RECOVERY</div>
      <h1>Find your way back.</h1>
      <p className="muted">
        Enter your email and we’ll send a secure, one-hour reset link if a
        password account exists.
      </p>
      {sent ? (
        <Notice>Check your inbox. You can close this page afterward.</Notice>
      ) : (
        <form onSubmit={submit}>
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required />
          </label>
          {error && <Notice>{error}</Notice>}
          <button className="button olive full" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"} <ArrowRight size={17} />
          </button>
        </form>
      )}
      <p className="auth-switch">
        <Link to="/login">Return to sign in</Link>
      </p>
    </AuthPage>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ token, new_password: data.get("new_password") }),
      });
      setComplete(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthPage>
      <div className="eyebrow">SECURE YOUR ACCOUNT</div>
      <h1>{complete ? "Password updated." : "Choose a new password."}</h1>
      {complete ? (
        <>
          <CheckCircle2 size={30} />
          <p className="muted">Every existing session has been signed out.</p>
          <Link className="button olive" to="/login">
            Sign in <ArrowRight size={17} />
          </Link>
        </>
      ) : (
        <form onSubmit={submit}>
          {!token && <Notice>This reset link is incomplete.</Notice>}
          <label>
            New password
            <input
              name="new_password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
              placeholder="At least 12 characters"
            />
          </label>
          {error && <Notice>{error}</Notice>}
          <button className="button olive full" disabled={busy || !token}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      )}
    </AuthPage>
  );
}

export function VerifyEmail() {
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState<"working" | "complete" | "error">(
    "working",
  );
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("This verification link is incomplete.");
      return;
    }
    api("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(async () => {
        await refresh();
        setState("complete");
      })
      .catch((error: Error) => {
        setState("error");
        setMessage(error.message);
      });
  }, [refresh, token]);
  return (
    <AuthPage>
      <div className="eyebrow">EMAIL VERIFICATION</div>
      <h1>
        {state === "working"
          ? "Confirming your email…"
          : state === "complete"
            ? "Email confirmed."
            : "We couldn’t confirm that link."}
      </h1>
      {state === "complete" ? (
        <>
          <CheckCircle2 size={30} />
          <p className="muted">Your NOMA account is now verified.</p>
          <Link className="button olive" to="/account">
            Open your account <ArrowRight size={17} />
          </Link>
        </>
      ) : state === "error" ? (
        <Notice>{message}</Notice>
      ) : (
        <p className="muted">This will only take a moment.</p>
      )}
    </AuthPage>
  );
}
