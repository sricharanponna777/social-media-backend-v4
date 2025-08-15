-- Reset script for social_media_v3 database
-- This script will drop and recreate the public schema, effectively resetting all tables
-- WARNING: This will delete all data in the database

-- Disconnect all other sessions
SELECT pg_terminate_backend(pg_stat_activity.pid)
FROM pg_stat_activity
WHERE pg_stat_activity.datname = 'social_media_v3'
  AND pid <> pg_backend_pid();

-- Drop and recreate public schema
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Grant privileges
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Set default privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON TABLES TO public;

-- Comment on schema
COMMENT ON SCHEMA public IS 'standard public schema';

-- Now run the schema.sql file to recreate all tables
\i '/Volumes/Macintosh SSD/Code/webdev/social-media-backend-v4/src/db/schema.sql'
