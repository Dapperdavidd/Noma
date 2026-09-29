import { createContext, useContext, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { User } from "./api";

export const Auth = createContext<{
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
}>({ user: null, loading: true, refresh: async () => {} });
export function useAuth() {
  return useContext(Auth);
}
export function Protected({
  children,
  agent = false,
}: {
  children: ReactNode;
  agent?: boolean;
}) {
  const { user, loading } = useAuth();
  if (loading) return <main className="section">Loading your account…</main>;
  if (!user)
    return (
      <main className="section empty">
        <h1>Make yourself at home.</h1>
        <p>Sign in to access this part of NOMA.</p>
        <Link className="button olive" to="/login">
          Sign in <ArrowRight size={16} />
        </Link>
      </main>
    );
  if (agent && user.role === "user")
    return (
      <main className="section empty">
        <h1>Your NOMA account</h1>
        <p>You’re signed in as a property seeker.</p>
        <Link className="button olive" to="/saved">
          View saved properties
        </Link>
      </main>
    );
  return <>{children}</>;
}
