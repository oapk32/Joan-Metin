-- Baseline compatible with the existing manually-created Oracle PostgreSQL 16 tables.
-- Never drop existing accounts, characters or player data.
CREATE TABLE IF NOT EXISTS accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS characters (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id),
    name VARCHAR(32) NOT NULL UNIQUE,
    class VARCHAR(32) NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    exp BIGINT NOT NULL DEFAULT 0,
    yang BIGINT NOT NULL DEFAULT 0,
    map_id VARCHAR(64) NOT NULL DEFAULT 'village',
    pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
    pos_y DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The joan_app role is provisioned before applying migrations on Oracle.
GRANT CONNECT ON DATABASE joan_metiny TO joan_app;
GRANT USAGE ON SCHEMA public TO joan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, characters TO joan_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO joan_app;
