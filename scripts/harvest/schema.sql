CREATE TABLE IF NOT EXISTS products (
  id         BIGSERIAL PRIMARY KEY,
  jan        TEXT UNIQUE,
  title      TEXT NOT NULL,
  brand      TEXT,
  category   TEXT NOT NULL,
  image_url  TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id           BIGSERIAL PRIMARY KEY,
  product_id   BIGINT NOT NULL REFERENCES products(id),
  platform     TEXT NOT NULL CHECK (platform IN ('amazon','rakuten','yahoo')),
  platform_id  TEXT NOT NULL,
  title        TEXT,
  pack_count   INT DEFAULT 1,
  match_source TEXT NOT NULL,
  confidence   REAL,
  is_active    BOOLEAN DEFAULT true,
  verified_at  TIMESTAMPTZ,
  UNIQUE (platform, platform_id)
);
CREATE INDEX IF NOT EXISTS listings_product_platform_idx ON listings (product_id, platform);

CREATE TABLE IF NOT EXISTS harvest_state (
  product_id BIGINT PRIMARY KEY REFERENCES products(id),
  stage      TEXT NOT NULL,
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
