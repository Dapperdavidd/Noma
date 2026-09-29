CREATE TABLE users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE CHECK (email = lower(email)),
 password_hash text NOT NULL, first_name text NOT NULL, last_name text NOT NULL,
 phone text, role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','agent','admin')),
 is_active boolean NOT NULL DEFAULT true, is_verified boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE agent_profiles (
 id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES users ON DELETE CASCADE,
 agency_name text, bio text, profile_image_url text,
 verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE states (id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE);
CREATE TABLE cities (id uuid PRIMARY KEY, state_id uuid NOT NULL REFERENCES states, name text NOT NULL, slug text NOT NULL, UNIQUE(state_id,slug), UNIQUE(id,state_id));
CREATE TABLE areas (id uuid PRIMARY KEY, city_id uuid NOT NULL REFERENCES cities, name text NOT NULL, slug text NOT NULL, UNIQUE(city_id,slug), UNIQUE(id,city_id));
CREATE TABLE properties (
 id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES users, title varchar(200) NOT NULL,
 slug text NOT NULL UNIQUE, description text NOT NULL,
 listing_type text NOT NULL CHECK(listing_type IN ('sale','rent','short_let')),
 property_type text NOT NULL CHECK(property_type IN ('apartment','house','duplex','land','commercial','office')),
 price bigint NOT NULL CHECK(price > 0 AND price <= 9007199254740991), currency char(3) NOT NULL DEFAULT 'NGN',
 rental_period text CHECK(rental_period IN ('day','month','year')),
 bedrooms smallint CHECK(bedrooms >= 0), bathrooms smallint CHECK(bathrooms >= 0),
 toilets smallint CHECK(toilets >= 0), parking_spaces smallint CHECK(parking_spaces >= 0),
 size_sqm integer CHECK(size_sqm > 0),
 state_id uuid NOT NULL REFERENCES states, city_id uuid NOT NULL, area_id uuid,
 FOREIGN KEY(city_id,state_id) REFERENCES cities(id,state_id),
 FOREIGN KEY(area_id,city_id) REFERENCES areas(id,city_id),
 address text NOT NULL, latitude numeric(9,6) CHECK(latitude BETWEEN -90 AND 90), longitude numeric(9,6) CHECK(longitude BETWEEN -180 AND 180),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','sold','rented','expired','suspended')),
 is_verified boolean NOT NULL DEFAULT false, featured_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 CHECK ((listing_type = 'sale' AND rental_period IS NULL) OR (listing_type <> 'sale' AND rental_period IS NOT NULL))
);
CREATE INDEX properties_newest ON properties(created_at DESC,id DESC) WHERE status='active';
CREATE INDEX properties_location ON properties(city_id,listing_type,price,id) WHERE status='active';
CREATE INDEX properties_area ON properties(area_id,listing_type,price,id) WHERE status='active';
CREATE INDEX properties_owner ON properties(agent_id,created_at DESC);
CREATE INDEX properties_search ON properties USING gin(to_tsvector('english',title || ' ' || description));
CREATE TABLE property_images (
 id uuid PRIMARY KEY, property_id uuid NOT NULL REFERENCES properties ON DELETE CASCADE,
 url text NOT NULL CHECK(url LIKE 'https://%'), public_id text, position smallint NOT NULL CHECK(position >= 0),
 is_cover boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(property_id,position)
);
CREATE UNIQUE INDEX one_cover_per_property ON property_images(property_id) WHERE is_cover;
CREATE TABLE amenities (id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE);
CREATE TABLE property_amenities (property_id uuid REFERENCES properties ON DELETE CASCADE, amenity_id uuid REFERENCES amenities, PRIMARY KEY(property_id,amenity_id));
CREATE TABLE favorites (user_id uuid REFERENCES users ON DELETE CASCADE, property_id uuid REFERENCES properties ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,property_id));
CREATE TABLE inquiries (
 id uuid PRIMARY KEY, property_id uuid NOT NULL REFERENCES properties, user_id uuid NOT NULL REFERENCES users,
 message text NOT NULL CHECK(length(message) BETWEEN 10 AND 3000),
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inquiries_owner_lookup ON inquiries(property_id,created_at DESC);
