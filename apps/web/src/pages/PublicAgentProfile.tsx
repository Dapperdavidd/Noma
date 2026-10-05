import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarCheck,
  Star,
} from "lucide-react";
import { api } from "../api";
import { Footer, Header, Notice } from "../components";

type AgentReview = {
  id: string;
  rating: number;
  communication: number;
  punctuality: number;
  property_accuracy: number;
  professionalism: number;
  comment: string;
  reviewer_name: string;
  created_at: string;
};

type PublicProfile = {
  id: string;
  first_name: string;
  last_name: string;
  agency_name: string | null;
  bio: string | null;
  profile_image_url: string | null;
  verification_status: string;
  rating: number;
  review_count: number;
  completed_inspections: number;
  active_properties: number;
  member_since: string;
  reviews: AgentReview[];
};

function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={16}
          fill={star <= Math.round(value) ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

export function PublicAgentProfile() {
  const { id } = useParams();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<PublicProfile>(`/agents/${id}`)
      .then(setProfile)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <>
      <Header />
      <main className="section public-agent-page">
        <Link className="text-link" to="/discover">
          <ArrowLeft size={15} /> Back to discover
        </Link>
        {error && <Notice>{error}</Notice>}
        {profile ? (
          <>
            <section className="agent-hero-card">
              <div className="agent-avatar-large">
                {profile.first_name[0]}
                {profile.last_name[0]}
              </div>
              <div>
                <div className="eyebrow">NOMA AGENT PROFILE</div>
                <h1>
                  {profile.first_name} {profile.last_name}
                </h1>
                <p>{profile.agency_name || "Independent property agent"}</p>
                <div className="agent-trust-line">
                  {profile.verification_status === "verified" && (
                    <span>
                      <BadgeCheck size={16} /> Identity verified
                    </span>
                  )}
                  <span>
                    <Stars value={profile.rating} /> {profile.rating || "New"} (
                    {profile.review_count} reviews)
                  </span>
                </div>
              </div>
            </section>
            <div className="agent-metrics">
              <div>
                <Building2 />
                <strong>{profile.active_properties}</strong>
                <span>Active properties</span>
              </div>
              <div>
                <CalendarCheck />
                <strong>{profile.completed_inspections}</strong>
                <span>Completed inspections</span>
              </div>
              <div>
                <Star />
                <strong>{profile.rating || "—"}</strong>
                <span>Customer rating</span>
              </div>
            </div>
            <section className="agent-about">
              <div className="eyebrow">ABOUT THE AGENT</div>
              <h2>Experience you can understand.</h2>
              <p>
                {profile.bio || "This agent has not added a biography yet."}
              </p>
            </section>
            <section className="agent-reviews">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">VERIFIED INSPECTION REVIEWS</div>
                  <h2>What customers experienced.</h2>
                </div>
              </div>
              {profile.reviews.length ? (
                <div className="review-grid">
                  {profile.reviews.map((review) => (
                    <article key={review.id}>
                      <Stars value={review.rating} />
                      <p>{review.comment}</p>
                      <strong>{review.reviewer_name}</strong>
                      <small>
                        {new Date(review.created_at).toLocaleDateString(
                          "en-NG",
                          { dateStyle: "medium" },
                        )}
                      </small>
                      <dl>
                        <div>
                          <dt>Communication</dt>
                          <dd>{review.communication}/5</dd>
                        </div>
                        <div>
                          <dt>Punctuality</dt>
                          <dd>{review.punctuality}/5</dd>
                        </div>
                        <div>
                          <dt>Property accuracy</dt>
                          <dd>{review.property_accuracy}/5</dd>
                        </div>
                        <div>
                          <dt>Professionalism</dt>
                          <dd>{review.professionalism}/5</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty compact-empty">
                  <Star size={34} />
                  <h3>No reviews yet.</h3>
                  <p>
                    Only customers with completed NOMA inspections can leave a
                    review.
                  </p>
                </div>
              )}
            </section>
          </>
        ) : !error ? (
          <div className="skeleton" />
        ) : null}
      </main>
      <Footer />
    </>
  );
}
