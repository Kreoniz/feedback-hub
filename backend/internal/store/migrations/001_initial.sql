CREATE TABLE reports (
 id uuid PRIMARY KEY,
 project text NOT NULL CHECK (project IN ('campus','unlikely-ui','other')),
 type text NOT NULL CHECK (type IN ('feature','bug')),
 title text NOT NULL CHECK (char_length(title)<=160),
 description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 5000),
 details text NOT NULL DEFAULT '' CHECK (char_length(details)<=8000),
 context jsonb NOT NULL DEFAULT '{}',
 fingerprint bytea NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','planned','in_progress','done','closed')),
 moderation text NOT NULL DEFAULT 'pending' CHECK (moderation IN ('pending','approved','rejected','spam')),
 priority text NOT NULL DEFAULT 'untriaged' CHECK (priority IN ('untriaged','low','normal','high','critical')),
 information text NOT NULL DEFAULT 'sparse' CHECK (information IN ('sparse','useful','detailed')),
 duplicate_of uuid REFERENCES reports(id),
 admin_note text NOT NULL DEFAULT '' CHECK (char_length(admin_note)<=8000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (type <> 'bug' OR moderation <> 'approved'),
 CHECK (duplicate_of IS NULL OR duplicate_of <> id),
 CHECK (type <> 'feature' OR char_length(title)>0)
);
CREATE INDEX reports_public ON reports(project,created_at DESC) WHERE type='feature' AND moderation='approved' AND duplicate_of IS NULL;
CREATE INDEX reports_admin ON reports(created_at DESC);
CREATE TABLE votes (
 report_id uuid NOT NULL REFERENCES reports(id),
 visitor bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(report_id,visitor)
);
CREATE TABLE vote_cooldowns (
 report_id uuid NOT NULL REFERENCES reports(id),
 network bytea NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(report_id,network)
);
CREATE INDEX vote_cooldowns_expiry ON vote_cooldowns(expires_at);
CREATE TABLE sessions (
 token_hash bytea PRIMARY KEY,
 csrf text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
