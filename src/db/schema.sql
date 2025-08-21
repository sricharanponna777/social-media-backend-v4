-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- For GIN indexes on B-tree-indexable columns
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- For query performance monitoring
CREATE EXTENSION IF NOT EXISTS "pg_cron"; -- For scheduled cleanup tasks

-- PostgreSQL configuration
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- Utility Functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE FUNCTION cleanup_expired_stories() 
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM stories WHERE expires_at < NOW();
END;
$$;

-- Function to update counters
CREATE OR REPLACE FUNCTION update_counter(
    table_name text,
    id_column text,
    id_value uuid,
    counter_column text,
    delta integer
) RETURNS void AS $$
BEGIN
    EXECUTE format('
        UPDATE %I 
        SET %I = GREATEST(%I + $1, 0)
        WHERE %I = $2',
        table_name,
        counter_column,
        counter_column,
        id_column
    ) USING delta, id_value;
END;
$$ LANGUAGE plpgsql;

-- Function to check if user can view content
CREATE OR REPLACE FUNCTION can_view_content(
    viewer_id uuid,
    content_owner_id uuid,
    content_visibility text DEFAULT 'public'
) RETURNS boolean AS $$
DECLARE
    is_following boolean;
    is_friend boolean;
BEGIN
    -- Public content is always visible
    IF content_visibility = 'public' THEN
        RETURN true;
    END IF;

    -- Owner can always view their own content
    IF viewer_id = content_owner_id THEN
        RETURN true;
    END IF;

    -- Check if user is following (no status field, just check if a row exists)
    SELECT EXISTS(
        SELECT 1 FROM follows 
        WHERE follower_id = viewer_id 
        AND following_id = content_owner_id
    ) INTO is_following;

    -- For followers-only content
    IF content_visibility = 'followers' THEN
        RETURN is_following;
    END IF;

    -- For close friends content
    IF content_visibility = 'friends' THEN
        SELECT EXISTS(
            SELECT 1 FROM friends 
            WHERE user_id = content_owner_id 
            AND friend_id = viewer_id
            AND status = 'accepted' -- Ensure the friendship is accepted
        ) INTO is_friend;
        RETURN is_friend;
    END IF;

    RETURN false;
END;
$$ LANGUAGE plpgsql;


-- Base Tables

-- Users and Authentication
CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    email varchar(255) NOT NULL UNIQUE,
    mobile_number varchar(50) NOT NULL,
    username varchar(50) NOT NULL UNIQUE,
    password_hash text NOT NULL,
    first_name varchar(50),
    last_name varchar(50),
    full_name varchar(101) GENERATED ALWAYS AS (
        CASE 
            WHEN last_name IS NULL THEN first_name
            WHEN first_name IS NULL THEN last_name
            ELSE first_name || ' ' || last_name
        END
    ) STORED,
    avatar_url text,
    cover_photo_url text,
    bio text,
    location varchar(100),
    website varchar(255),
    is_private boolean NOT NULL DEFAULT false,
    is_verified boolean NOT NULL DEFAULT false,
    email_or_phone_verified boolean NOT NULL DEFAULT false,
    is_banned boolean NOT NULL DEFAULT false,
    last_active_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_full_name ON users(full_name) WHERE deleted_at IS NULL;

COMMENT ON TABLE users IS 'User accounts and profiles';

-- Password Reset Tokens
CREATE TABLE password_reset_tokens (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token varchar(255) NOT NULL UNIQUE,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);

COMMENT ON TABLE password_reset_tokens IS 'Tokens for password reset requests';

-- Email and Phone Verification
CREATE TABLE verification_otps (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    otp char(6) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verify_otps_user_id ON verification_otps(user_id);
CREATE INDEX IF NOT EXISTS idx_verify_otps_otp ON verification_otps(otp);

COMMENT ON TABLE password_reset_tokens IS 'Tokens for password reset requests';

-- Content Tables

-- Posts
CREATE TABLE posts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content text,
    media_urls text[],
    location varchar(100),
    visibility varchar(20) NOT NULL DEFAULT 'public',
    is_edited boolean NOT NULL DEFAULT false,
    is_pinned boolean NOT NULL DEFAULT false,
    is_archived boolean NOT NULL DEFAULT false,
    comments_count integer NOT NULL DEFAULT 0,
    likes_count integer NOT NULL DEFAULT 0,
    shares_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    search_vector tsvector,
    CONSTRAINT chk_posts_visibility CHECK (visibility IN ('public', 'private', 'followers', 'friends'))
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_search ON posts USING GIN(search_vector);

COMMENT ON TABLE posts IS 'User posts and media content';

-- Comments
CREATE TABLE post_comments (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id uuid REFERENCES post_comments(id) ON DELETE CASCADE,
    content text NOT NULL,
    is_edited boolean NOT NULL DEFAULT false,
    is_pinned boolean NOT NULL DEFAULT false,
    replies_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    search_vector tsvector
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_user_id ON post_comments(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_parent_id ON post_comments(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_search ON post_comments USING GIN(search_vector);

COMMENT ON TABLE post_comments IS 'Comments on posts';

-- Stories
CREATE TABLE stories (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_url text NOT NULL,
    media_type varchar(20) NOT NULL,
    caption text,
    location varchar(100),
    duration integer NOT NULL DEFAULT 5,
    is_highlighted boolean NOT NULL DEFAULT false,
    poll_type varchar(20),
    views_count integer NOT NULL DEFAULT 0,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_stories_media_type CHECK (media_type IN ('image', 'video', 'text', 'poll')),
    CONSTRAINT chk_stories_poll_type CHECK (poll_type IN ('yes_no', 'multiple_choice', 'slider', NULL))
);

CREATE INDEX IF NOT EXISTS idx_stories_user_id ON stories(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories(expires_at) WHERE deleted_at IS NULL;

COMMENT ON TABLE stories IS 'Temporary user stories';

-- Story Views
CREATE TABLE story_views (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    view_duration INTEGER,
    completed_viewing BOOLEAN DEFAULT FALSE,
    device_info JSONB DEFAULT '{}',
    location_data JSONB DEFAULT '{}',
    interaction_data JSONB DEFAULT '{}',
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(story_id, user_id),
    CONSTRAINT positive_view_duration CHECK (view_duration >= 0)
);

-- REMOVED: Redundant index covered by the UNIQUE constraint above.
-- CREATE INDEX IF NOT EXISTS idx_story_views_story_id ON story_views(story_id); 
CREATE INDEX IF NOT EXISTS idx_story_views_user_id ON story_views(user_id);
-- REMOVED: Redundant index covered by the UNIQUE constraint above.
-- CREATE INDEX IF NOT EXISTS idx_story_views_story_user ON story_views(story_id, user_id);

COMMENT ON TABLE story_views IS 'Story view tracking';

-- Relationships

-- Follows
CREATE TABLE follows (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_id, following_id),
    CONSTRAINT chk_follows_self CHECK (follower_id != following_id)
);


CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_follows_status ON follows(status);

COMMENT ON TABLE follows IS 'User follow relationships';

-- Close Friends
CREATE TABLE friends (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
    UNIQUE(user_id, friend_id),
    CONSTRAINT chk_friends_self CHECK (user_id != friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);

COMMENT ON TABLE friends IS 'Close friends list for private stories';

-- Messaging

-- Conversations
CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title varchar(100),
    type varchar(20) NOT NULL DEFAULT 'private',
    last_message_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_conversations_type CHECK (type IN ('private', 'group'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_creator_id ON conversations(creator_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type) WHERE deleted_at IS NULL;

COMMENT ON TABLE conversations IS 'Chat conversations';

-- Conversation Participants
CREATE TABLE conversation_participants (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname varchar(50),
    role varchar(20) NOT NULL DEFAULT 'member',
    last_read_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    UNIQUE(conversation_id, user_id),
    CONSTRAINT chk_conversation_participants_role CHECK (role IN ('member', 'admin', 'owner'))
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id ON conversation_participants(conversation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON conversation_participants(user_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE conversation_participants IS 'Participants in conversations';

-- Messages
CREATE TABLE messages (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    message text,
    message_type varchar(20) NOT NULL DEFAULT 'text',
    media_url text,
    is_edited boolean NOT NULL DEFAULT false,
    edited_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_messages_type CHECK (message_type IN ('text', 'image', 'video', 'file', 'audio'))
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE messages IS 'Chat messages';

-- Create partitions for messages
-- NOTE: For a production system, you should have a script that periodically creates future partitions.
CREATE TABLE messages_y2024 PARTITION OF messages
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE messages_y2025 PARTITION OF messages
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE messages_y2026 PARTITION OF messages
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- Add constraints to partitions
ALTER TABLE messages_y2024 ADD PRIMARY KEY (id, created_at);
ALTER TABLE messages_y2025 ADD PRIMARY KEY (id, created_at);
ALTER TABLE messages_y2026 ADD PRIMARY KEY (id, created_at);

ALTER TABLE messages_y2024 ADD FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE messages_y2025 ADD FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE messages_y2026 ADD FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

ALTER TABLE messages_y2024 ADD FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE messages_y2025 ADD FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE messages_y2026 ADD FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

-- Indexes on the parent partitioned table will be propagated to partitions.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC) WHERE deleted_at IS NULL;

-- Content Engagement

-- Reactions
CREATE TABLE reactions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name varchar(50) NOT NULL UNIQUE,
    icon_url text,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_reactions_name CHECK (name IN ('like', 'love', 'haha', 'wow', 'sad', 'angry'))
);

COMMENT ON TABLE reactions IS 'Available reaction types';

-- Content Reactions
CREATE TABLE content_reactions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_id uuid NOT NULL REFERENCES reactions(id) ON DELETE CASCADE,
    content_type varchar(20) NOT NULL,
    content_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_type, content_id),
    CONSTRAINT chk_content_reactions_type CHECK (content_type IN ('post', 'comment', 'story', 'reel'))
);

-- Insert standard reactions
INSERT INTO reactions (name, icon_url) VALUES
('like', '/icons/reactions/like.svg'),
('love', '/icons/reactions/love.svg'),
('haha', '/icons/reactions/haha.svg'),
('wow', '/icons/reactions/wow.svg'),
('sad', '/icons/reactions/sad.svg'),
('angry', '/icons/reactions/angry.svg')
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_content_reactions_content ON content_reactions(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_content_reactions_user_id ON content_reactions(user_id);

COMMENT ON TABLE content_reactions IS 'All content reactions in one table';

-- Notifications
CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
    type varchar(50) NOT NULL,
    target_type varchar(50),
    target_id uuid,
    message text NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at timestamp with time zone,
    CONSTRAINT chk_notifications_type CHECK (type IN (
        'follow_request', 'follow_accept', 
        'post_like', 'post_comment', 
        'comment_like', 'comment_reply',
        'message', 'mention', 
        'story_view', 'story_reaction'
    ))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

COMMENT ON TABLE notifications IS 'User notifications';

-- Content Moderation
CREATE TABLE reported_content (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type varchar(50) NOT NULL,
    content_id uuid NOT NULL,
    reason varchar(100) NOT NULL,
    description text,
    status varchar(20) NOT NULL DEFAULT 'pending',
    resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_reported_content_type CHECK (content_type IN ('user', 'post', 'comment', 'message', 'story')),
    CONSTRAINT chk_reported_content_status CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_reported_content_content ON reported_content(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_reported_content_status ON reported_content(status);

COMMENT ON TABLE reported_content IS 'Reported content for moderation';

-- Affiliate Marketing System
CREATE TABLE affiliate_products (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name varchar(255) NOT NULL,
    description text,
    image_url text,
    price numeric(10,2),
    external_url text NOT NULL,
    platform varchar(50),
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_platform ON affiliate_products(platform) WHERE deleted_at IS NULL;
COMMENT ON TABLE affiliate_products IS 'Products available for affiliate marketing';

CREATE TABLE affiliate_links (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES affiliate_products(id) ON DELETE CASCADE,
    affiliate_url text NOT NULL,
    clicks_count integer NOT NULL DEFAULT 0,
    conversions_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_links_user_id ON affiliate_links(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_affiliate_links_product_id ON affiliate_links(product_id) WHERE deleted_at IS NULL;
COMMENT ON TABLE affiliate_links IS 'User-specific affiliate marketing links';

CREATE TABLE affiliate_clicks (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    link_id uuid NOT NULL REFERENCES affiliate_links(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ip_address inet,
    user_agent text,
    referrer text,
    clicked_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_link_id ON affiliate_clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_user_id ON affiliate_clicks(user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_clicked_at ON affiliate_clicks(clicked_at);
COMMENT ON TABLE affiliate_clicks IS 'Tracking affiliate link clicks';

CREATE TABLE affiliate_purchases (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    click_id uuid NOT NULL REFERENCES affiliate_clicks(id) ON DELETE CASCADE,
    order_id varchar(100),
    amount numeric(10,2) NOT NULL,
    commission numeric(10,2) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    purchased_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_affiliate_purchases_status CHECK (status IN ('pending', 'confirmed', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_purchases_click_id ON affiliate_purchases(click_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_purchases_status ON affiliate_purchases(status);
COMMENT ON TABLE affiliate_purchases IS 'Affiliate purchase tracking and commissions';

CREATE TABLE user_earnings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_earned numeric(10,2) NOT NULL DEFAULT 0,
    pending_amount numeric(10,2) NOT NULL DEFAULT 0,
    last_payout_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_earnings_user_id ON user_earnings(user_id);
COMMENT ON TABLE user_earnings IS 'User affiliate earnings tracking';

-- Reels System
CREATE TABLE reels (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_url text NOT NULL,
    thumbnail_url text,
    duration integer,
    caption text,
    music_track_url text,
    music_track_name varchar(255),
    music_artist_name varchar(255),
    views_count integer NOT NULL DEFAULT 0,
    comments_count integer NOT NULL DEFAULT 0,
    shares_count integer NOT NULL DEFAULT 0,
    is_original boolean NOT NULL DEFAULT true,
    original_reel_id uuid REFERENCES reels(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_reels_user_id ON reels(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reels_created_at ON reels(created_at DESC) WHERE deleted_at IS NULL;
COMMENT ON TABLE reels IS 'Short-form video content';

CREATE TABLE reel_comments (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    reel_id uuid NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_reel_comments_reel_id ON reel_comments(reel_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reel_comments_user_id ON reel_comments(user_id) WHERE deleted_at IS NULL;
COMMENT ON TABLE reel_comments IS 'Comments on reels';

CREATE TABLE reel_views (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    reel_id uuid NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    watch_duration integer,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(reel_id, user_id)
);

-- REMOVED: Redundant index covered by the UNIQUE constraint above.
-- CREATE INDEX IF NOT EXISTS idx_reel_views_reel_id ON reel_views(reel_id);
CREATE INDEX IF NOT EXISTS idx_reel_views_user_id ON reel_views(user_id);
COMMENT ON TABLE reel_views IS 'Reel view tracking';

-- User Interests System
CREATE TABLE user_interests (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name varchar(100) NOT NULL UNIQUE,
    display_name varchar(100) NOT NULL,
    category varchar(50),
    icon_url text,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_interests_category ON user_interests(category);
COMMENT ON TABLE user_interests IS 'Available user interests/topics';

CREATE TABLE user_interest_map (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interest_id uuid NOT NULL REFERENCES user_interests(id) ON DELETE CASCADE,
    affinity_score numeric(3,2),
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, interest_id),
    CONSTRAINT chk_user_interest_map_affinity CHECK (affinity_score >= 0 AND affinity_score <= 1)
);

CREATE INDEX IF NOT EXISTS idx_user_interest_map_user_id ON user_interest_map(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interest_map_interest_id ON user_interest_map(interest_id);
COMMENT ON TABLE user_interest_map IS 'User interest preferences and affinities';

-- Triggers

-- Updated At Triggers
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_post_comments_updated_at
    BEFORE UPDATE ON post_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Search Vector Updates
CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.location, '')), 'B') ||
        setweight(
            to_tsvector(
                'english',
                COALESCE(
                    (
                        SELECT string_agg(
                            u.username || ' ' || COALESCE(u.full_name, ''), ' '
                        )
                        FROM (
                            SELECT m[1] AS username
                            FROM regexp_matches(NEW.content, '@(\w+)', 'g') AS m
                        ) AS mentions
                        JOIN users u ON u.username = mentions.username
                    ),
                    ''
                )
            ),
            'C'
        );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_search_vector_update
    BEFORE INSERT OR UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION posts_search_vector_update();

CREATE OR REPLACE FUNCTION post_comments_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'A');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER post_comments_search_vector_update
    BEFORE INSERT OR UPDATE ON post_comments
    FOR EACH ROW
    EXECUTE FUNCTION post_comments_search_vector_update();

-- Counter Update Triggers

-- Comments counter for posts
CREATE OR REPLACE FUNCTION update_post_comments_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('posts', 'id', NEW.post_id, 'comments_count', 1);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM update_counter('posts', 'id', OLD.post_id, 'comments_count', -1);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_post_comments_count_insert_trigger
    AFTER INSERT ON post_comments
    FOR EACH ROW
    WHEN (NEW.parent_id IS NULL)
    EXECUTE FUNCTION update_post_comments_count();

CREATE TRIGGER update_post_comments_count_delete_trigger
    AFTER DELETE ON post_comments
    FOR EACH ROW
    WHEN (OLD.parent_id IS NULL)
    EXECUTE FUNCTION update_post_comments_count();

-- Reply counter for comments
CREATE OR REPLACE FUNCTION update_comment_replies_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.parent_id IS NOT NULL THEN
        PERFORM update_counter('post_comments', 'id', NEW.parent_id, 'replies_count', 1);
    ELSIF TG_OP = 'DELETE' AND OLD.parent_id IS NOT NULL THEN
        PERFORM update_counter('post_comments', 'id', OLD.parent_id, 'replies_count', -1);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_comment_replies_count_trigger
    AFTER INSERT OR DELETE ON post_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_comment_replies_count();

-- Story views counter
CREATE OR REPLACE FUNCTION update_story_views_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('stories', 'id', NEW.story_id, 'views_count', 1);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_story_views_count_trigger
    AFTER INSERT ON story_views
    FOR EACH ROW
    EXECUTE FUNCTION update_story_views_count();

-- Reel views counter
CREATE OR REPLACE FUNCTION update_reel_views_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('reels', 'id', NEW.reel_id, 'views_count', 1);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_reel_views_count_trigger
    AFTER INSERT ON reel_views
    FOR EACH ROW
    EXECUTE FUNCTION update_reel_views_count();

-- Reel comments counter
CREATE OR REPLACE FUNCTION update_reel_comments_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('reels', 'id', NEW.reel_id, 'comments_count', 1);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM update_counter('reels', 'id', OLD.reel_id, 'comments_count', -1);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_reel_comments_count_trigger
    AFTER INSERT OR DELETE ON reel_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_reel_comments_count();



-- Content reactions counter
CREATE OR REPLACE FUNCTION update_content_reactions_count() RETURNS TRIGGER AS $$
BEGIN
    -- Handle different content types
    IF TG_OP = 'INSERT' THEN
        IF NEW.content_type = 'post' THEN
            PERFORM update_counter('posts', 'id', NEW.content_id, 'likes_count', 1);
        -- Add other content types as needed
        -- ELSIF NEW.content_type = 'comment' THEN
        --    PERFORM update_counter('post_comments', 'id', NEW.content_id, 'likes_count', 1);
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.content_type = 'post' THEN
            PERFORM update_counter('posts', 'id', OLD.content_id, 'likes_count', -1);
        -- Add other content types as needed
        -- ELSIF OLD.content_type = 'comment' THEN
        --    PERFORM update_counter('post_comments', 'id', OLD.content_id, 'likes_count', -1);
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_content_reactions_count_trigger
    AFTER INSERT OR DELETE ON content_reactions
    FOR EACH ROW
    EXECUTE FUNCTION update_content_reactions_count();

-- Affiliate clicks counter
CREATE OR REPLACE FUNCTION update_affiliate_clicks_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('affiliate_links', 'id', NEW.link_id, 'clicks_count', 1);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_affiliate_clicks_count_trigger
    AFTER INSERT ON affiliate_clicks
    FOR EACH ROW
    EXECUTE FUNCTION update_affiliate_clicks_count();

-- Affiliate conversions counter
CREATE OR REPLACE FUNCTION update_affiliate_conversions_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Update conversions count on affiliate_links
        UPDATE affiliate_links 
        SET conversions_count = conversions_count + 1
        WHERE id = (SELECT link_id FROM affiliate_clicks WHERE id = NEW.click_id);
        
        -- Update user earnings
        INSERT INTO user_earnings (user_id, total_earned, pending_amount)
        SELECT al.user_id, NEW.commission, NEW.commission
        FROM affiliate_clicks ac
        JOIN affiliate_links al ON al.id = ac.link_id
        WHERE ac.id = NEW.click_id
        ON CONFLICT (user_id) 
        DO UPDATE SET 
            pending_amount = user_earnings.pending_amount + NEW.commission,
            updated_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_affiliate_conversions_count_trigger
    AFTER INSERT ON affiliate_purchases
    FOR EACH ROW
    WHEN (NEW.status = 'confirmed')
    EXECUTE FUNCTION update_affiliate_conversions_count();

-- Add triggers for new tables
CREATE TRIGGER update_affiliate_products_updated_at
    BEFORE UPDATE ON affiliate_products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_affiliate_links_updated_at
    BEFORE UPDATE ON affiliate_links
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_affiliate_purchases_updated_at
    BEFORE UPDATE ON affiliate_purchases
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_earnings_updated_at
    BEFORE UPDATE ON user_earnings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reels_updated_at
    BEFORE UPDATE ON reels
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reel_comments_updated_at
    BEFORE UPDATE ON reel_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_interests_updated_at
    BEFORE UPDATE ON user_interests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_interest_map_updated_at
    BEFORE UPDATE ON user_interest_map
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();



-- Create scheduled cleanup job for expired stories
SELECT cron.schedule('cleanup-expired-stories', '0 0 * * *', 'SELECT cleanup_expired_stories();');

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_last_active_at ON users(last_active_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stories_user_created ON stories(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reels_user_created ON reels(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reactions_user_content ON content_reactions(user_id, content_type, content_id);

-- Add composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_follows_follower_status ON follows(follower_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following_status ON follows(following_id, status);
CREATE INDEX IF NOT EXISTS idx_friends_user_status ON friends(user_id, status);

-- Performance optimization indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_story_views_story_created ON story_views(story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_views_reel_created ON reel_views(reel_id, created_at DESC);

-- Partial indexes for active content
CREATE INDEX IF NOT EXISTS idx_posts_active ON posts(created_at DESC) WHERE deleted_at IS NULL AND visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_reels_active ON reels(created_at DESC) WHERE deleted_at IS NULL;
