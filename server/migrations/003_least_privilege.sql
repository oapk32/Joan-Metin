-- Least-privilege cleanup of the broad grants used by the early local prototype.
-- Existing data is unchanged. Account password hashes must never be writable
-- through generic game application queries; future password-change flows will
-- require a dedicated, reviewed security boundary.
REVOKE UPDATE, DELETE ON accounts FROM joan_app;
REVOKE DELETE ON characters, character_saves FROM joan_app;

-- Keep only operations needed for current account signup, owned character
-- creation and internal server-only snapshot persistence.
GRANT SELECT, INSERT ON accounts TO joan_app;
GRANT SELECT, INSERT, UPDATE ON characters, character_saves TO joan_app;
