import { useEffect, useRef, useState } from "react";
import { api, type User } from "./api";

type GoogleResponse = { credential: string };
type GoogleApi = {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback: (response: GoogleResponse) => void;
      }): void;
      renderButton(
        target: HTMLElement,
        options: Record<string, string | number>,
      ): void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleApi;
  }
}

let googleScript: Promise<void> | undefined;
function loadGoogle() {
  if (window.google) return Promise.resolve();
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[src="https://accounts.google.com/gsi/client"]',
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Unable to load Google sign-in"));
      document.head.append(script);
    });
  }
  return googleScript;
}

export function GoogleButton({
  role,
  onSignedIn,
  onError,
}: {
  role: "user" | "agent";
  onSignedIn: (user: User) => void;
  onError: (message: string) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    api<{ google_client_id: string | null }>("/auth/providers")
      .then((value) => setClientId(value.google_client_id))
      .catch(() => setClientId(null));
  }, []);

  useEffect(() => {
    if (!clientId || !target.current) return;
    let active = true;
    loadGoogle()
      .then(() => {
        if (!active || !window.google || !target.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            api<User>("/auth/google", {
              method: "POST",
              body: JSON.stringify({ credential, role }),
            })
              .then(onSignedIn)
              .catch((error: Error) => onError(error.message));
          },
        });
        target.current.replaceChildren();
        window.google.accounts.id.renderButton(target.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: role === "agent" ? "signup_with" : "continue_with",
          width: target.current.clientWidth,
        });
      })
      .catch(() => onError("Google sign-in could not be loaded"));
    return () => {
      active = false;
    };
  }, [clientId, onError, onSignedIn, role]);

  if (!clientId) return null;
  return (
    <div className="social-auth">
      <div className="auth-divider">
        <span>or</span>
      </div>
      <div ref={target} className="google-button" />
    </div>
  );
}
