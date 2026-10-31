-- Runs once when the Postgres volume is first created (docker-entrypoint-initdb.d).
-- The image's POSTGRES_USER is a superuser, and superusers skip row-level security. The API
-- therefore owns its database through an ordinary role: it can migrate its own schema, and
-- FORCE ROW LEVEL SECURITY applies to it.
CREATE ROLE sampledge LOGIN PASSWORD 'sampledge' NOSUPERUSER NOBYPASSRLS NOCREATEROLE CREATEDB;
CREATE DATABASE sampledge OWNER sampledge;
