import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { hero } from "../demo";
import { Header, Footer } from "../components";

export function Discover() {
  return (
    <>
      <Header />
      <main className="section discover">
        <div className="eyebrow">REAL PEOPLE. REAL SPACES.</div>
        <h1>
          Home is more
          <br />
          than an address.
        </h1>
        <p className="intro">
          It’s the morning light, the familiar street, the space to become who
          you want to be. NOMA is built to help you find it.
        </p>
        <img src={hero} alt="A calm, light-filled modern home" />
        <div className="discover-grid">
          <h2>
            Made for your
            <br />
            next chapter.
          </h2>
          <div>
            <p>
              We’re creating a simpler way to discover property across Nigeria.
              A place where clear information and direct conversations help you
              move forward with confidence.
            </p>
            <p>
              Buy, rent, or find a short stay. List a space and connect with
              someone who sees its potential.
            </p>
            <Link className="text-link" to="/properties">
              Find your place <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
