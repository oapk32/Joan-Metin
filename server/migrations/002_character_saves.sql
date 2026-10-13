-- Additive online character persistence. Existing rows and manual schema are retained.
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS characters_account_id_id_idx ON characters(account_id, id);

-- Only trusted server gameplay code may write snapshots.
-- State holds future equipment, inventory, skills and quests in versioned JSON.
-- The browser has no endpoint for writing arbitrary economy/inventory values.
CREATE TABLE IF NOT EXISTS character_saves (
    character_id BIGINT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL DEFAULT 1,
    revision BIGINT NOT NULL DEFAULT 0,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT character_saves_schema_version_check CHECK (schema_version BETWEEN 1 AND 1000),
    CONSTRAINT character_saves_revision_check CHECK (revision >= 0),
    CONSTRAINT character_saves_object_check CHECK (jsonb_typeof(state) = 'object'),
    CONSTRAINT character_saves_size_check CHECK (octet_length(state::text) <= 262144)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON character_saves TO joan_app;
