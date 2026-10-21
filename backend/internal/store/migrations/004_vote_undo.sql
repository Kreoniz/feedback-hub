-- Keep one lifetime-budgeted row per visitor/report, including undone votes.
-- Re-voting reactivates that row without spending another slot or growing history.
ALTER TABLE votes ADD COLUMN active boolean NOT NULL DEFAULT true;
