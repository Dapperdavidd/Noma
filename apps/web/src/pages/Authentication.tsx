import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api, type User } from "../api";
import { hero } from "../demo";
import { Header, Notice } from "../components";
import { useAuth } from "../auth";

export function Authentication() {
  const [params] = useSearchParams();
  const isJoin = location.pathname === "/join";
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await api<User>(isJoin ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      await refresh();
      navigate(user.role === "agent" ? "/dashboard" : "/properties");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header />
      <main className="auth-layout">
        <div
          className="auth-photo"
          style={{
            backgroundImage: `linear-gradient(0deg,rgba(0,0,0,.55),transparent),url(${hero})`,
          }}
        >
          <div className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div>
          <h1>
            Good spaces.
            <br />
            Great beginnings.
          </h1>
          <p>Real people. Real spaces. NOMA.</p>
        </div>
        <div className="auth-form">
          <div className="eyebrow">WELCOME TO NOMA</div>
          <h1>{isJoin ? "Find your place." : "Welcome home."}</h1>
          <p className="muted">
            {isJoin
              ? "A home, an opportunity, a fresh start. Let’s find yours."
              : "Sign in to pick up where you left off."}
          </p>
          <form onSubmit={submit}>
            {isJoin && (
              <div className="form-row">
                <label>
                  First name
                  <input
                    name="first_name"
                    autoComplete="given-name"
                    required
                    maxLength={100}
                  />
                </label>
                <label>
                  Last name
                  <input
                    name="last_name"
                    autoComplete="family-name"
                    required
                    maxLength={100}
                  />
                </label>
              </div>
            )}
            <label>
              Email address
              <input type="email" name="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={isJoin ? "new-password" : "current-password"}
                minLength={isJoin ? 12 : 1}
                maxLength={128}
                required
                placeholder={isJoin ? "At least 12 characters" : ""}
              />
            </label>
            {isJoin && (
              <label>
                I’m here to
                <select
                  name="role"
                  defaultValue={
                    params.get("role") === "agent" ? "agent" : "user"
                  }
                >
                  <option value="user">Find a home</option>
                  <option value="agent">List and manage properties</option>
                </select>
              </label>
            )}
            {error && <Notice>{error}</Notice>}
            <button disabled={busy} className="button olive full">
              {busy ? "One moment…" : isJoin ? "Create account" : "Sign in"}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-switch">
            {isJoin ? "Already have an account?" : "New to NOMA?"}{" "}
            <Link to={isJoin ? "/login" : "/join"}>
              {isJoin ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
