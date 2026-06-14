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
  genre_id     TEXT,
  is_active    BOOLEAN DEFAULT true,
  verified_at  TIMESTAMPTZ,
  UNIQUE (platform, platform_id)
);
CREATE INDEX IF NOT EXISTS listings_product_platform_idx ON listings (product_id, platform);
CREATE INDEX IF NOT EXISTS listings_platform_id_idx ON listings (platform_id);

-- Added after initial deploy; ALTER is idempotent so re-running migrate is safe.
-- genre_id stores Rakuten Ichiba's per-item genreId (the structured signal that
-- feeds resolveCategory tier-2). products.category is queried per-genre by the
-- harvest, so it gets its own index.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS genre_id TEXT;
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);

CREATE TABLE IF NOT EXISTS harvest_state (
  product_id BIGINT PRIMARY KEY REFERENCES products(id),
  stage      TEXT NOT NULL,
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
