#!/bin/sh
set -eu
# psql reads a generated hex password from a file; no secret in shell argv or logs.
psql --username postgres --dbname feedback --set ON_ERROR_STOP=1 <<'SQL'
\set app_password `cat /run/secrets/db_password`
CREATE ROLE feedback LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
ALTER DATABASE feedback OWNER TO feedback;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO feedback;
SQL
