-- Internal helpers and trigger functions must never be directly callable by
-- browser roles. Later-created functions do not inherit the initial schema
-- migration's revocation, so enforce the boundary again at the current head.
revoke all on all functions in schema app_private from public, anon, authenticated;
