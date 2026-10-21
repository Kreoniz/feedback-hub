CREATE TABLE intake_totals (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 reports bigint NOT NULL CHECK(reports>=0),
 votes bigint NOT NULL CHECK(votes>=0)
);
INSERT INTO intake_totals(id,reports,votes) SELECT true,(SELECT count(*) FROM reports),(SELECT count(*) FROM votes);
CREATE TABLE intake_days (
 day date NOT NULL,
 project text NOT NULL CHECK(project IN ('*','campus','unlikely-ui','other')),
 accepted integer NOT NULL DEFAULT 0 CHECK(accepted>=0),
 PRIMARY KEY(day,project)
);
ALTER TABLE sessions ADD COLUMN last_seen timestamptz NOT NULL DEFAULT now();
