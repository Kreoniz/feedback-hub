ALTER TABLE reports DROP CONSTRAINT reports_fingerprint_key;
CREATE INDEX reports_fingerprint_recent ON reports(fingerprint, created_at DESC);
