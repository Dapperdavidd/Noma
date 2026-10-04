import { useCallback, useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api, type User } from "./api";
import { Auth, Protected } from "./auth";
import { Header, Footer } from "./components";
import { AgentProfile } from "./pages/AgentProfile";
import { Account } from "./pages/Account";
import { Admin } from "./pages/Admin";
import { Home } from "./pages/Home";
import { Browse } from "./pages/Browse";
import { Authentication } from "./pages/Authentication";
import { Detail } from "./pages/Detail";
import { Dashboard } from "./pages/Dashboard";
import { ListingForm } from "./pages/ListingForm";
import { Saved } from "./pages/Saved";
import { Discover } from "./pages/Discover";
import {
  ForgotPassword,
  ResetPassword,
  VerifyEmail,
} from "./pages/PasswordRecovery";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setUser(await api<User>("/auth/me"));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Auth.Provider value={{ user, loading, refresh }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/properties" element={<Browse />} />
        <Route path="/properties/:slug" element={<Detail />} />
        <Route path="/login" element={<Authentication key="login" />} />
        <Route path="/join" element={<Authentication key="join" />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/discover" element={<Discover />} />
        <Route
          path="/account"
          element={
            <>
              <Header />
              <Protected>
                <main className="section">
                  <Account />
                </main>
              </Protected>
              <Footer />
            </>
          }
        />
        <Route
          path="/saved"
          element={
            <>
              <Header />
              <Protected>
                <main className="section">
                  <Saved />
                </main>
              </Protected>
              <Footer />
            </>
          }
        />
        <Route
          path="/dashboard"
          element={
            <>
              <Header />
              <Protected>
                <main className="section">
                  <Dashboard />
                </main>
              </Protected>
              <Footer />
            </>
          }
        />
        <Route
          path="/dashboard/profile"
          element={
            <>
              <Header />
              <Protected agent>
                <main className="section">
                  <AgentProfile />
                </main>
              </Protected>
              <Footer />
            </>
          }
        />
        <Route
          path="/admin"
          element={
            <>
              <Header />
              <Protected agent>
                <main className="section">
                  <Admin />
                </main>
              </Protected>
              <Footer />
            </>
          }
        />
        <Route
          path="/dashboard/new"
          element={
            <>
              <Header />
              <Protected>
                <main className="section">
                  <ListingForm />
                </main>
              </Protected>
              <Footer />
            </>
          }
        />
        <Route
          path="/dashboard/edit/:slug"
          element={
            <>
              <Header />
              <Protected>
                <main className="section">
                  <ListingForm />
                </main>
              </Protected>
              <Footer />
            </>
          }
        />
        <Route
          path="*"
          element={
            <>
              <Header />
              <main className="section empty">
                <h1>This door leads somewhere else.</h1>
                <Link to="/" className="button olive">
                  Back home <ArrowRight size={16} />
                </Link>
              </main>
            </>
          }
        />
      </Routes>
    </Auth.Provider>
  );
}
