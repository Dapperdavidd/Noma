import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BadgeCheck, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { Notice } from "../components";

type VerificationState = {
  property: {
    id: string;
    title: string;
    slug: string;
    status: string;
    is_verified: boolean;
    lister_relationship: "owner" | "authorized_agent";
  };
  application: null | {
    status: "pending" | "approved" | "rejected" | "withdrawn";
    evidence_type: string;
    document_reference: string | null;
    evidence_note: string;
    evidence_url: string | null;
    review_reason: string | null;
    submitted_at: string;
  };
};

export function PropertyVerification() {
  const { id } = useParams();
  const [state, setState] = useState<VerificationState | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setState(await api<VerificationState>(`/properties/${id}/verification`));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [id]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const values = Object.fromEntries(new FormData(e.currentTarget));
      await api(`/properties/${id}/verification`, {
        method: "POST",
        body: JSON.stringify({ ...values, declaration: true }),
      });
      await load();
      setMessage("Your property verification application is now under review.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const application = state?.application;
  const locked =
    state?.property.is_verified || application?.status === "pending";
  return (
    <>
      <Link className="text-link" to="/dashboard">
        <ArrowLeft size={16} /> Your properties
      </Link>
      <div className="form-intro">
        <div className="eyebrow">PROPERTY TRUST</div>
        <h1>Verify the listing.</h1>
        <p className="muted">
          Verification tells customers that NOMA reviewed the listing evidence.
          It does not replace an inspection or independent legal checks.
        </p>
      </div>
      {error && <Notice>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {state && (
        <>
          <section className="verification-property-card">
            <div>
              <span className="eyebrow">PROPERTY</span>
              <h2>{state.property.title}</h2>
              <p className="muted">
                Listed as{" "}
                {state.property.lister_relationship.replaceAll("_", " ")}
              </p>
            </div>
            <Link
              className="text-link"
              to={`/properties/${state.property.slug}`}
            >
              View listing <ArrowRight size={15} />
            </Link>
          </section>
          {locked ? (
            <div
              className={`verification-summary ${state.property.is_verified ? "verified" : "pending"}`}
            >
              {state.property.is_verified ? (
                <BadgeCheck size={22} />
              ) : (
                <ShieldCheck size={22} />
              )}
              <div>
                <strong>
                  {state.property.is_verified
                    ? "NOMA verified property"
                    : "Application under review"}
                </strong>
                <span>
                  {state.property.is_verified
                    ? "The verified badge stays active until important listing details change."
                    : "Editing this listing withdraws the application so the updated details can be submitted again."}
                </span>
              </div>
            </div>
          ) : (
            <form className="listing-form verification-form" onSubmit={submit}>
              {application?.status === "rejected" &&
                application.review_reason && (
                  <Notice>Previous review: {application.review_reason}</Notice>
                )}
              <label>
                Evidence type
                <select
                  name="evidence_type"
                  required
                  defaultValue={application?.evidence_type || ""}
                >
                  <option value="" disabled>
                    Choose the strongest evidence available
                  </option>
                  <option value="certificate_of_occupancy">
                    Certificate of Occupancy
                  </option>
                  <option value="deed_of_assignment">Deed of Assignment</option>
                  <option value="tenancy_authorization">
                    Tenancy or landlord authorization
                  </option>
                  <option value="agency_mandate">Agency mandate</option>
                  <option value="other">Other supporting evidence</option>
                </select>
              </label>
              <label>
                Document reference
                <input
                  name="document_reference"
                  maxLength={200}
                  defaultValue={application?.document_reference || ""}
                  placeholder="Reference or registration number"
                />
              </label>
              <label>
                Evidence summary
                <textarea
                  name="evidence_note"
                  required
                  minLength={30}
                  maxLength={2000}
                  rows={6}
                  defaultValue={application?.evidence_note || ""}
                  placeholder="Explain your relationship to the property and what the evidence establishes."
                />
              </label>
              <label>
                Secure evidence link (optional)
                <input
                  name="evidence_url"
                  type="url"
                  maxLength={2048}
                  defaultValue={application?.evidence_url || ""}
                  placeholder="https://..."
                />
                <small>
                  Use a restricted link intended for the NOMA review team. This
                  link is never shown on the public listing.
                </small>
              </label>
              <label className="checkbox-label">
                <input type="checkbox" required />
                <span>
                  I confirm that I am the owner or have authority to market this
                  property, and that the submitted information is accurate.
                </span>
              </label>
              <button className="button olive" disabled={busy}>
                {busy ? "Submitting…" : "Submit for review"}
                <ShieldCheck size={16} />
              </button>
            </form>
          )}
        </>
      )}
    </>
  );
}
