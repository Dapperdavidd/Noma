CREATE TABLE billing_products (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('agent_subscription','featured_listing')),
    price_kobo bigint NOT NULL CHECK (price_kobo > 0),
    duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 366),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO billing_products(id,name,description,kind,price_kobo,duration_days)
VALUES
    ('agent_pro_monthly','NOMA Agent Pro','A monthly professional plan for active property agents.','agent_subscription',750000,30),
    ('featured_listing_30d','Featured listing','Priority placement for one active property for 30 days.','featured_listing',500000,30);

CREATE TABLE billing_purchases (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users ON DELETE RESTRICT,
    product_id text NOT NULL REFERENCES billing_products,
    property_id uuid REFERENCES properties ON DELETE RESTRICT,
    provider text NOT NULL DEFAULT 'paystack' CHECK (provider IN ('paystack')),
    provider_reference text NOT NULL UNIQUE,
    amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
    currency char(3) NOT NULL DEFAULT 'NGN',
    status text NOT NULL DEFAULT 'initialized'
        CHECK (status IN ('initialized','succeeded','failed','refunded')),
    checkout_url text CHECK (checkout_url LIKE 'https://%'),
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (product_id = 'featured_listing_30d' AND property_id IS NOT NULL)
        OR product_id <> 'featured_listing_30d'
    )
);

CREATE INDEX billing_purchases_user
ON billing_purchases(user_id, created_at DESC);

CREATE TABLE billing_entitlements (
    user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    product_id text NOT NULL REFERENCES billing_products,
    purchase_id uuid NOT NULL REFERENCES billing_purchases ON DELETE RESTRICT,
    starts_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,product_id),
    CHECK (expires_at > starts_at)
);
