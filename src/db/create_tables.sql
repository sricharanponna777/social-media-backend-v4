--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.5

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: apply_content_vote_counter(character varying, uuid, character varying, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.apply_content_vote_counter(p_content_type character varying, p_content_id uuid, p_vote_type character varying, p_delta integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF p_content_type = 'post' THEN
        IF p_vote_type = 'upvote' THEN
            PERFORM update_counter('posts', 'id', p_content_id, 'upvotes_count', p_delta);
        ELSE
            PERFORM update_counter('posts', 'id', p_content_id, 'downvotes_count', p_delta);
        END IF;
    ELSIF p_content_type = 'comment' THEN
        IF p_vote_type = 'upvote' THEN
            PERFORM update_counter('post_comments', 'id', p_content_id, 'upvotes_count', p_delta);
        ELSE
            PERFORM update_counter('post_comments', 'id', p_content_id, 'downvotes_count', p_delta);
        END IF;
    ELSIF p_content_type = 'story' THEN
        IF p_vote_type = 'upvote' THEN
            PERFORM update_counter('stories', 'id', p_content_id, 'upvotes_count', p_delta);
        ELSE
            PERFORM update_counter('stories', 'id', p_content_id, 'downvotes_count', p_delta);
        END IF;
    ELSIF p_content_type = 'reel' THEN
        IF p_vote_type = 'upvote' THEN
            PERFORM update_counter('reels', 'id', p_content_id, 'upvotes_count', p_delta);
        ELSE
            PERFORM update_counter('reels', 'id', p_content_id, 'downvotes_count', p_delta);
        END IF;
    END IF;
END;
$$;


ALTER FUNCTION public.apply_content_vote_counter(p_content_type character varying, p_content_id uuid, p_vote_type character varying, p_delta integer) OWNER TO postgres;

--
-- Name: can_view_content(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.can_view_content(viewer_id uuid, content_owner_id uuid, content_visibility text DEFAULT 'public'::text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.can_view_content(viewer_id uuid, content_owner_id uuid, content_visibility text) OWNER TO postgres;

--
-- Name: cleanup_expired_stories(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cleanup_expired_stories() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM stories WHERE expires_at < NOW();
END;
$$;


ALTER FUNCTION public.cleanup_expired_stories() OWNER TO postgres;

--
-- Name: post_comments_search_vector_update(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.post_comments_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.search_vector := setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'A');
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.post_comments_search_vector_update() OWNER TO postgres;

--
-- Name: posts_search_vector_update(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.posts_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.posts_search_vector_update() OWNER TO postgres;

--
-- Name: update_affiliate_clicks_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_affiliate_clicks_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('affiliate_links', 'id', NEW.link_id, 'clicks_count', 1);
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_affiliate_clicks_count() OWNER TO postgres;

--
-- Name: update_affiliate_conversions_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_affiliate_conversions_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.update_affiliate_conversions_count() OWNER TO postgres;

--
-- Name: update_comment_replies_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_comment_replies_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.parent_id IS NOT NULL THEN
        PERFORM update_counter('post_comments', 'id', NEW.parent_id, 'replies_count', 1);
    ELSIF TG_OP = 'DELETE' AND OLD.parent_id IS NOT NULL THEN
        PERFORM update_counter('post_comments', 'id', OLD.parent_id, 'replies_count', -1);
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_comment_replies_count() OWNER TO postgres;

--
-- Name: update_content_votes_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_content_votes_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM apply_content_vote_counter(NEW.content_type, NEW.content_id, NEW.vote_type, 1);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM apply_content_vote_counter(OLD.content_type, OLD.content_id, OLD.vote_type, -1);
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.content_type = NEW.content_type
           AND OLD.content_id = NEW.content_id
           AND OLD.vote_type = NEW.vote_type THEN
            RETURN NULL;
        END IF;

        PERFORM apply_content_vote_counter(OLD.content_type, OLD.content_id, OLD.vote_type, -1);
        PERFORM apply_content_vote_counter(NEW.content_type, NEW.content_id, NEW.vote_type, 1);
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_content_votes_count() OWNER TO postgres;

--
-- Name: update_counter(text, text, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_counter(table_name text, id_column text, id_value uuid, counter_column text, delta integer) RETURNS void
    LANGUAGE plpgsql
    AS $_$
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
$_$;


ALTER FUNCTION public.update_counter(table_name text, id_column text, id_value uuid, counter_column text, delta integer) OWNER TO postgres;

--
-- Name: update_post_comments_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_post_comments_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('posts', 'id', NEW.post_id, 'comments_count', 1);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM update_counter('posts', 'id', OLD.post_id, 'comments_count', -1);
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_post_comments_count() OWNER TO postgres;

--
-- Name: update_reel_comments_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_reel_comments_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('reels', 'id', NEW.reel_id, 'comments_count', 1);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM update_counter('reels', 'id', OLD.reel_id, 'comments_count', -1);
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_reel_comments_count() OWNER TO postgres;

--
-- Name: update_reel_views_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_reel_views_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('reels', 'id', NEW.reel_id, 'views_count', 1);
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_reel_views_count() OWNER TO postgres;

--
-- Name: update_story_views_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_story_views_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_counter('stories', 'id', NEW.story_id, 'views_count', 1);
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_story_views_count() OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: affiliate_clicks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.affiliate_clicks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    link_id uuid NOT NULL,
    user_id uuid,
    ip_address inet,
    user_agent text,
    referrer text,
    clicked_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.affiliate_clicks OWNER TO postgres;

--
-- Name: TABLE affiliate_clicks; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.affiliate_clicks IS 'Tracking affiliate link clicks';


--
-- Name: affiliate_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.affiliate_links (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    affiliate_url text NOT NULL,
    clicks_count integer DEFAULT 0 NOT NULL,
    conversions_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.affiliate_links OWNER TO postgres;

--
-- Name: TABLE affiliate_links; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.affiliate_links IS 'User-specific affiliate marketing links';


--
-- Name: affiliate_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.affiliate_products (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    image_url text,
    price numeric(10,2),
    external_url text NOT NULL,
    platform character varying(50),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.affiliate_products OWNER TO postgres;

--
-- Name: TABLE affiliate_products; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.affiliate_products IS 'Products available for affiliate marketing';


--
-- Name: affiliate_purchases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.affiliate_purchases (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    click_id uuid NOT NULL,
    order_id character varying(100),
    amount numeric(10,2) NOT NULL,
    commission numeric(10,2) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    purchased_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_affiliate_purchases_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'confirmed'::character varying, 'rejected'::character varying])::text[])))
);


ALTER TABLE public.affiliate_purchases OWNER TO postgres;

--
-- Name: TABLE affiliate_purchases; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.affiliate_purchases IS 'Affiliate purchase tracking and commissions';


--
-- Name: content_votes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.content_votes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    vote_type character varying(20) NOT NULL,
    content_type character varying(20) NOT NULL,
    content_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_content_votes_type CHECK (((content_type)::text = ANY ((ARRAY['post'::character varying, 'comment'::character varying, 'story'::character varying, 'reel'::character varying])::text[]))),
    CONSTRAINT chk_content_votes_vote_type CHECK (((vote_type)::text = ANY ((ARRAY['upvote'::character varying, 'downvote'::character varying])::text[])))
);


ALTER TABLE public.content_votes OWNER TO postgres;

--
-- Name: TABLE content_votes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.content_votes IS 'All content votes (upvotes/downvotes) in one table';


--
-- Name: conversation_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.conversation_participants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    nickname character varying(50),
    role character varying(20) DEFAULT 'member'::character varying NOT NULL,
    last_read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_conversation_participants_role CHECK (((role)::text = ANY ((ARRAY['member'::character varying, 'admin'::character varying, 'owner'::character varying])::text[])))
);


ALTER TABLE public.conversation_participants OWNER TO postgres;

--
-- Name: TABLE conversation_participants; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.conversation_participants IS 'Participants in conversations';


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.conversations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    title character varying(100),
    type character varying(20) DEFAULT 'private'::character varying NOT NULL,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_conversations_type CHECK (((type)::text = ANY ((ARRAY['private'::character varying, 'group'::character varying])::text[])))
);


ALTER TABLE public.conversations OWNER TO postgres;

--
-- Name: TABLE conversations; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.conversations IS 'Chat conversations';


--
-- Name: follows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.follows (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    follower_id uuid NOT NULL,
    following_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_follows_self CHECK ((follower_id <> following_id))
);


ALTER TABLE public.follows OWNER TO postgres;

--
-- Name: TABLE follows; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.follows IS 'User follow relationships';


--
-- Name: friends; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.friends (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    friend_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    CONSTRAINT chk_friends_self CHECK ((user_id <> friend_id)),
    CONSTRAINT friends_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'blocked'::character varying])::text[])))
);


ALTER TABLE public.friends OWNER TO postgres;

--
-- Name: TABLE friends; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.friends IS 'Close friends list for private stories';


--
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    message text,
    message_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    media_url text,
    is_edited boolean DEFAULT false NOT NULL,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_messages_type CHECK (((message_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'file'::character varying, 'audio'::character varying])::text[])))
)
PARTITION BY RANGE (created_at);


ALTER TABLE public.messages OWNER TO postgres;

--
-- Name: TABLE messages; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.messages IS 'Chat messages';


--
-- Name: messages_y2024; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages_y2024 (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    message text,
    message_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    media_url text,
    is_edited boolean DEFAULT false NOT NULL,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_messages_type CHECK (((message_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'file'::character varying, 'audio'::character varying])::text[])))
);


ALTER TABLE public.messages_y2024 OWNER TO postgres;

--
-- Name: messages_y2025; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages_y2025 (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    message text,
    message_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    media_url text,
    is_edited boolean DEFAULT false NOT NULL,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_messages_type CHECK (((message_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'file'::character varying, 'audio'::character varying])::text[])))
);


ALTER TABLE public.messages_y2025 OWNER TO postgres;

--
-- Name: messages_y2026; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages_y2026 (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    message text,
    message_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    media_url text,
    is_edited boolean DEFAULT false NOT NULL,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_messages_type CHECK (((message_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'file'::character varying, 'audio'::character varying])::text[])))
);


ALTER TABLE public.messages_y2026 OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    actor_id uuid,
    type character varying(50) NOT NULL,
    target_type character varying(50),
    target_id uuid,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    read_at timestamp with time zone,
    CONSTRAINT chk_notifications_type CHECK (((type)::text = ANY ((ARRAY['friend_request'::character varying, 'friend_request_accepted'::character varying, 'friend_request_rejected'::character varying, 'friend_removed'::character varying, 'friend_blocked'::character varying, 'post_like'::character varying, 'post_comment'::character varying, 'comment_like'::character varying, 'comment_reply'::character varying, 'message'::character varying, 'mention'::character varying, 'story_view'::character varying, 'story_reaction'::character varying])::text[])))
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.notifications IS 'User notifications';


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.password_reset_tokens OWNER TO postgres;

--
-- Name: TABLE password_reset_tokens; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.password_reset_tokens IS 'Tokens for password reset requests';


--
-- Name: post_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.post_comments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_id uuid,
    content text NOT NULL,
    is_edited boolean DEFAULT false NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    replies_count integer DEFAULT 0 NOT NULL,
    upvotes_count integer DEFAULT 0 NOT NULL,
    downvotes_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    search_vector tsvector
);


ALTER TABLE public.post_comments OWNER TO postgres;

--
-- Name: TABLE post_comments; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.post_comments IS 'Comments on posts';


--
-- Name: posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.posts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    content text,
    media_urls text[],
    location character varying(100),
    visibility character varying(20) DEFAULT 'public'::character varying NOT NULL,
    is_edited boolean DEFAULT false NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    comments_count integer DEFAULT 0 NOT NULL,
    upvotes_count integer DEFAULT 0 NOT NULL,
    downvotes_count integer DEFAULT 0 NOT NULL,
    shares_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    search_vector tsvector,
    CONSTRAINT chk_posts_visibility CHECK (((visibility)::text = ANY ((ARRAY['public'::character varying, 'private'::character varying, 'followers'::character varying, 'friends'::character varying])::text[])))
);


ALTER TABLE public.posts OWNER TO postgres;

--
-- Name: TABLE posts; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.posts IS 'User posts and media content';


--
-- Name: reel_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reel_comments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.reel_comments OWNER TO postgres;

--
-- Name: TABLE reel_comments; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.reel_comments IS 'Comments on reels';


--
-- Name: reel_views; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reel_views (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    watch_duration integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.reel_views OWNER TO postgres;

--
-- Name: TABLE reel_views; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.reel_views IS 'Reel view tracking';


--
-- Name: reels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reels (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    media_url text NOT NULL,
    thumbnail_url text,
    duration integer,
    caption text,
    music_track_url text,
    music_track_name character varying(255),
    music_artist_name character varying(255),
    views_count integer DEFAULT 0 NOT NULL,
    comments_count integer DEFAULT 0 NOT NULL,
    upvotes_count integer DEFAULT 0 NOT NULL,
    downvotes_count integer DEFAULT 0 NOT NULL,
    shares_count integer DEFAULT 0 NOT NULL,
    is_original boolean DEFAULT true NOT NULL,
    original_reel_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.reels OWNER TO postgres;

--
-- Name: TABLE reels; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.reels IS 'Short-form video content';


--
-- Name: reported_content; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reported_content (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reporter_id uuid NOT NULL,
    content_type character varying(50) NOT NULL,
    content_id uuid NOT NULL,
    reason character varying(100) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_reported_content_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'reviewed'::character varying, 'resolved'::character varying, 'dismissed'::character varying])::text[]))),
    CONSTRAINT chk_reported_content_type CHECK (((content_type)::text = ANY ((ARRAY['user'::character varying, 'post'::character varying, 'comment'::character varying, 'message'::character varying, 'story'::character varying])::text[])))
);


ALTER TABLE public.reported_content OWNER TO postgres;

--
-- Name: TABLE reported_content; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.reported_content IS 'Reported content for moderation';


--
-- Name: stories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    media_url text NOT NULL,
    media_type character varying(20) NOT NULL,
    caption text,
    location character varying(100),
    duration integer DEFAULT 5 NOT NULL,
    is_highlighted boolean DEFAULT false NOT NULL,
    poll_type character varying(20),
    views_count integer DEFAULT 0 NOT NULL,
    upvotes_count integer DEFAULT 0 NOT NULL,
    downvotes_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_stories_media_type CHECK (((media_type)::text = ANY ((ARRAY['image'::character varying, 'video'::character varying, 'text'::character varying, 'poll'::character varying])::text[]))),
    CONSTRAINT chk_stories_poll_type CHECK (((poll_type)::text = ANY ((ARRAY['yes_no'::character varying, 'multiple_choice'::character varying, 'slider'::character varying, NULL::character varying])::text[])))
);


ALTER TABLE public.stories OWNER TO postgres;

--
-- Name: TABLE stories; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.stories IS 'Temporary user stories';


--
-- Name: story_views; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.story_views (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    story_id uuid NOT NULL,
    user_id uuid NOT NULL,
    view_duration integer,
    completed_viewing boolean DEFAULT false,
    device_info jsonb DEFAULT '{}'::jsonb,
    location_data jsonb DEFAULT '{}'::jsonb,
    interaction_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT positive_view_duration CHECK ((view_duration >= 0))
);


ALTER TABLE public.story_views OWNER TO postgres;

--
-- Name: TABLE story_views; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.story_views IS 'Story view tracking';


--
-- Name: user_earnings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_earnings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    total_earned numeric(10,2) DEFAULT 0 NOT NULL,
    pending_amount numeric(10,2) DEFAULT 0 NOT NULL,
    last_payout_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.user_earnings OWNER TO postgres;

--
-- Name: TABLE user_earnings; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.user_earnings IS 'User affiliate earnings tracking';


--
-- Name: user_interest_map; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_interest_map (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    interest_id uuid NOT NULL,
    affinity_score numeric(3,2),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_user_interest_map_affinity CHECK (((affinity_score >= (0)::numeric) AND (affinity_score <= (1)::numeric)))
);


ALTER TABLE public.user_interest_map OWNER TO postgres;

--
-- Name: TABLE user_interest_map; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.user_interest_map IS 'User interest preferences and affinities';


--
-- Name: user_interests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_interests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    display_name character varying(100) NOT NULL,
    category character varying(50),
    icon_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.user_interests OWNER TO postgres;

--
-- Name: TABLE user_interests; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.user_interests IS 'Available user interests/topics';


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    mobile_number character varying(50) NOT NULL,
    username character varying(50) NOT NULL,
    password_hash text NOT NULL,
    first_name character varying(50),
    last_name character varying(50),
    full_name character varying(101) GENERATED ALWAYS AS (
CASE
    WHEN (last_name IS NULL) THEN (first_name)::text
    WHEN (first_name IS NULL) THEN (last_name)::text
    ELSE (((first_name)::text || ' '::text) || (last_name)::text)
END) STORED,
    avatar_url text,
    cover_photo_url text,
    bio text,
    location character varying(100),
    website character varying(255),
    is_private boolean DEFAULT false NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    email_or_phone_verified boolean DEFAULT false NOT NULL,
    is_banned boolean DEFAULT false NOT NULL,
    last_active_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.users IS 'User accounts and profiles';


--
-- Name: verification_otps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.verification_otps (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    otp character(6) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.verification_otps OWNER TO postgres;

--
-- Name: messages_y2024; Type: TABLE ATTACH; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages ATTACH PARTITION public.messages_y2024 FOR VALUES FROM ('2024-01-01 00:00:00+00') TO ('2025-01-01 00:00:00+00');


--
-- Name: messages_y2025; Type: TABLE ATTACH; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages ATTACH PARTITION public.messages_y2025 FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');


--
-- Name: messages_y2026; Type: TABLE ATTACH; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages ATTACH PARTITION public.messages_y2026 FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');


--
-- Name: affiliate_clicks affiliate_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_clicks
    ADD CONSTRAINT affiliate_clicks_pkey PRIMARY KEY (id);


--
-- Name: affiliate_links affiliate_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_links
    ADD CONSTRAINT affiliate_links_pkey PRIMARY KEY (id);


--
-- Name: affiliate_links affiliate_links_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_links
    ADD CONSTRAINT affiliate_links_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- Name: affiliate_products affiliate_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_products
    ADD CONSTRAINT affiliate_products_pkey PRIMARY KEY (id);


--
-- Name: affiliate_purchases affiliate_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_purchases
    ADD CONSTRAINT affiliate_purchases_pkey PRIMARY KEY (id);


--
-- Name: content_votes content_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.content_votes
    ADD CONSTRAINT content_votes_pkey PRIMARY KEY (id);


--
-- Name: content_votes content_votes_user_id_content_type_content_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.content_votes
    ADD CONSTRAINT content_votes_user_id_content_type_content_id_key UNIQUE (user_id, content_type, content_id);


--
-- Name: conversation_participants conversation_participants_conversation_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_conversation_id_user_id_key UNIQUE (conversation_id, user_id);


--
-- Name: conversation_participants conversation_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: follows follows_follower_id_following_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_following_id_key UNIQUE (follower_id, following_id);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (id);


--
-- Name: friends friends_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.friends
    ADD CONSTRAINT friends_pkey PRIMARY KEY (id);


--
-- Name: friends friends_user_id_friend_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.friends
    ADD CONSTRAINT friends_user_id_friend_id_key UNIQUE (user_id, friend_id);


--
-- Name: messages_y2024 messages_y2024_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages_y2024
    ADD CONSTRAINT messages_y2024_pkey PRIMARY KEY (id, created_at);


--
-- Name: messages_y2025 messages_y2025_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages_y2025
    ADD CONSTRAINT messages_y2025_pkey PRIMARY KEY (id, created_at);


--
-- Name: messages_y2026 messages_y2026_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages_y2026
    ADD CONSTRAINT messages_y2026_pkey PRIMARY KEY (id, created_at);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);


--
-- Name: post_comments post_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_pkey PRIMARY KEY (id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: reel_comments reel_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reel_comments
    ADD CONSTRAINT reel_comments_pkey PRIMARY KEY (id);


--
-- Name: reel_views reel_views_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reel_views
    ADD CONSTRAINT reel_views_pkey PRIMARY KEY (id);


--
-- Name: reel_views reel_views_reel_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reel_views
    ADD CONSTRAINT reel_views_reel_id_user_id_key UNIQUE (reel_id, user_id);


--
-- Name: reels reels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reels
    ADD CONSTRAINT reels_pkey PRIMARY KEY (id);


--
-- Name: reported_content reported_content_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reported_content
    ADD CONSTRAINT reported_content_pkey PRIMARY KEY (id);


--
-- Name: stories stories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_pkey PRIMARY KEY (id);


--
-- Name: story_views story_views_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT story_views_pkey PRIMARY KEY (id);


--
-- Name: story_views story_views_story_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT story_views_story_id_user_id_key UNIQUE (story_id, user_id);


--
-- Name: user_earnings user_earnings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_earnings
    ADD CONSTRAINT user_earnings_pkey PRIMARY KEY (id);


--
-- Name: user_earnings user_earnings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_earnings
    ADD CONSTRAINT user_earnings_user_id_key UNIQUE (user_id);


--
-- Name: user_interest_map user_interest_map_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_interest_map
    ADD CONSTRAINT user_interest_map_pkey PRIMARY KEY (id);


--
-- Name: user_interest_map user_interest_map_user_id_interest_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_interest_map
    ADD CONSTRAINT user_interest_map_user_id_interest_id_key UNIQUE (user_id, interest_id);


--
-- Name: user_interests user_interests_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_interests
    ADD CONSTRAINT user_interests_name_key UNIQUE (name);


--
-- Name: user_interests user_interests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_interests
    ADD CONSTRAINT user_interests_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: verification_otps verification_otps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.verification_otps
    ADD CONSTRAINT verification_otps_pkey PRIMARY KEY (id);


--
-- Name: idx_affiliate_clicks_clicked_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_affiliate_clicks_clicked_at ON public.affiliate_clicks USING btree (clicked_at);


--
-- Name: idx_affiliate_clicks_link_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_affiliate_clicks_link_id ON public.affiliate_clicks USING btree (link_id);


--
-- Name: idx_affiliate_clicks_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_affiliate_clicks_user_id ON public.affiliate_clicks USING btree (user_id);


--
-- Name: idx_affiliate_links_product_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_affiliate_links_product_id ON public.affiliate_links USING btree (product_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_affiliate_links_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_affiliate_links_user_id ON public.affiliate_links USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_affiliate_products_platform; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_affiliate_products_platform ON public.affiliate_products USING btree (platform) WHERE (deleted_at IS NULL);


--
-- Name: idx_affiliate_purchases_click_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_affiliate_purchases_click_id ON public.affiliate_purchases USING btree (click_id);


--
-- Name: idx_affiliate_purchases_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_affiliate_purchases_status ON public.affiliate_purchases USING btree (status);


--
-- Name: idx_content_votes_content; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_content_votes_content ON public.content_votes USING btree (content_type, content_id, vote_type);


--
-- Name: idx_content_votes_user_content; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_content_votes_user_content ON public.content_votes USING btree (user_id, content_type, content_id);


--
-- Name: idx_content_votes_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_content_votes_user_id ON public.content_votes USING btree (user_id);


--
-- Name: idx_conversation_participants_conversation_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_conversation_participants_conversation_id ON public.conversation_participants USING btree (conversation_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_conversation_participants_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_conversation_participants_user_id ON public.conversation_participants USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_conversations_creator_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_conversations_creator_id ON public.conversations USING btree (creator_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_conversations_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_conversations_type ON public.conversations USING btree (type) WHERE (deleted_at IS NULL);


--
-- Name: idx_follows_follower_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_follows_follower_id ON public.follows USING btree (follower_id);


--
-- Name: idx_follows_following_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_follows_following_id ON public.follows USING btree (following_id);


--
-- Name: idx_friends_friend_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_friends_friend_id ON public.friends USING btree (friend_id);


--
-- Name: idx_friends_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_friends_user_id ON public.friends USING btree (user_id);


--
-- Name: idx_friends_user_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_friends_user_status ON public.friends USING btree (user_id, status);


--
-- Name: idx_messages_conversation_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_messages_conversation_created ON ONLY public.messages USING btree (conversation_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_messages_conversation_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_messages_conversation_id ON ONLY public.messages USING btree (conversation_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_messages_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_messages_created_at ON ONLY public.messages USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_messages_sender_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_messages_sender_id ON ONLY public.messages USING btree (sender_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_is_read; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_notifications_user_read; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user_read ON public.notifications USING btree (user_id, is_read, created_at DESC);


--
-- Name: idx_password_reset_tokens_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_password_reset_tokens_token ON public.password_reset_tokens USING btree (token);


--
-- Name: idx_password_reset_tokens_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_password_reset_tokens_user_id ON public.password_reset_tokens USING btree (user_id);


--
-- Name: idx_post_comments_parent_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_comments_parent_id ON public.post_comments USING btree (parent_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_post_comments_post_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_comments_post_id ON public.post_comments USING btree (post_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_post_comments_search; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_comments_search ON public.post_comments USING gin (search_vector);


--
-- Name: idx_post_comments_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_comments_user_id ON public.post_comments USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_posts_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_active ON public.posts USING btree (created_at DESC) WHERE ((deleted_at IS NULL) AND ((visibility)::text = 'public'::text));


--
-- Name: idx_posts_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_created_at ON public.posts USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_posts_search; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_search ON public.posts USING gin (search_vector);


--
-- Name: idx_posts_user_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_user_created ON public.posts USING btree (user_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_posts_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_user_id ON public.posts USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_posts_visibility; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_visibility ON public.posts USING btree (visibility) WHERE (deleted_at IS NULL);


--
-- Name: idx_reel_comments_reel_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reel_comments_reel_id ON public.reel_comments USING btree (reel_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_reel_comments_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reel_comments_user_id ON public.reel_comments USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_reel_views_reel_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reel_views_reel_created ON public.reel_views USING btree (reel_id, created_at DESC);


--
-- Name: idx_reel_views_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reel_views_user_id ON public.reel_views USING btree (user_id);


--
-- Name: idx_reels_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reels_active ON public.reels USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_reels_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reels_created_at ON public.reels USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_reels_user_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reels_user_created ON public.reels USING btree (user_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_reels_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reels_user_id ON public.reels USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_reported_content_content; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reported_content_content ON public.reported_content USING btree (content_type, content_id);


--
-- Name: idx_reported_content_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reported_content_status ON public.reported_content USING btree (status);


--
-- Name: idx_stories_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stories_created_at ON public.stories USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_stories_expires_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stories_expires_at ON public.stories USING btree (expires_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_stories_user_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stories_user_created ON public.stories USING btree (user_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_stories_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stories_user_id ON public.stories USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_story_views_story_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_story_views_story_created ON public.story_views USING btree (story_id, created_at DESC);


--
-- Name: idx_story_views_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_story_views_user_id ON public.story_views USING btree (user_id);


--
-- Name: idx_user_earnings_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_earnings_user_id ON public.user_earnings USING btree (user_id);


--
-- Name: idx_user_interest_map_interest_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_interest_map_interest_id ON public.user_interest_map USING btree (interest_id);


--
-- Name: idx_user_interest_map_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_interest_map_user_id ON public.user_interest_map USING btree (user_id);


--
-- Name: idx_user_interests_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_interests_category ON public.user_interests USING btree (category);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_email ON public.users USING btree (email) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_full_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_full_name ON public.users USING btree (full_name) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_last_active_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_last_active_at ON public.users USING btree (last_active_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_username ON public.users USING btree (username) WHERE (deleted_at IS NULL);


--
-- Name: idx_verify_otps_otp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_verify_otps_otp ON public.verification_otps USING btree (otp);


--
-- Name: idx_verify_otps_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_verify_otps_user_id ON public.verification_otps USING btree (user_id);


--
-- Name: messages_y2024_conversation_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2024_conversation_id_created_at_idx ON public.messages_y2024 USING btree (conversation_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2024_conversation_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2024_conversation_id_idx ON public.messages_y2024 USING btree (conversation_id) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2024_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2024_created_at_idx ON public.messages_y2024 USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2024_sender_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2024_sender_id_idx ON public.messages_y2024 USING btree (sender_id) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2025_conversation_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2025_conversation_id_created_at_idx ON public.messages_y2025 USING btree (conversation_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2025_conversation_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2025_conversation_id_idx ON public.messages_y2025 USING btree (conversation_id) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2025_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2025_created_at_idx ON public.messages_y2025 USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2025_sender_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2025_sender_id_idx ON public.messages_y2025 USING btree (sender_id) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2026_conversation_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2026_conversation_id_created_at_idx ON public.messages_y2026 USING btree (conversation_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2026_conversation_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2026_conversation_id_idx ON public.messages_y2026 USING btree (conversation_id) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2026_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2026_created_at_idx ON public.messages_y2026 USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2026_sender_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_y2026_sender_id_idx ON public.messages_y2026 USING btree (sender_id) WHERE (deleted_at IS NULL);


--
-- Name: messages_y2024_conversation_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_conversation_created ATTACH PARTITION public.messages_y2024_conversation_id_created_at_idx;


--
-- Name: messages_y2024_conversation_id_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_conversation_id ATTACH PARTITION public.messages_y2024_conversation_id_idx;


--
-- Name: messages_y2024_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_created_at ATTACH PARTITION public.messages_y2024_created_at_idx;


--
-- Name: messages_y2024_sender_id_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_sender_id ATTACH PARTITION public.messages_y2024_sender_id_idx;


--
-- Name: messages_y2025_conversation_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_conversation_created ATTACH PARTITION public.messages_y2025_conversation_id_created_at_idx;


--
-- Name: messages_y2025_conversation_id_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_conversation_id ATTACH PARTITION public.messages_y2025_conversation_id_idx;


--
-- Name: messages_y2025_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_created_at ATTACH PARTITION public.messages_y2025_created_at_idx;


--
-- Name: messages_y2025_sender_id_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_sender_id ATTACH PARTITION public.messages_y2025_sender_id_idx;


--
-- Name: messages_y2026_conversation_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_conversation_created ATTACH PARTITION public.messages_y2026_conversation_id_created_at_idx;


--
-- Name: messages_y2026_conversation_id_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_conversation_id ATTACH PARTITION public.messages_y2026_conversation_id_idx;


--
-- Name: messages_y2026_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_created_at ATTACH PARTITION public.messages_y2026_created_at_idx;


--
-- Name: messages_y2026_sender_id_idx; Type: INDEX ATTACH; Schema: public; Owner: postgres
--

ALTER INDEX public.idx_messages_sender_id ATTACH PARTITION public.messages_y2026_sender_id_idx;


--
-- Name: post_comments post_comments_search_vector_update; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER post_comments_search_vector_update BEFORE INSERT OR UPDATE ON public.post_comments FOR EACH ROW EXECUTE FUNCTION public.post_comments_search_vector_update();


--
-- Name: posts posts_search_vector_update; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER posts_search_vector_update BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.posts_search_vector_update();


--
-- Name: affiliate_clicks update_affiliate_clicks_count_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_affiliate_clicks_count_trigger AFTER INSERT ON public.affiliate_clicks FOR EACH ROW EXECUTE FUNCTION public.update_affiliate_clicks_count();


--
-- Name: affiliate_purchases update_affiliate_conversions_count_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_affiliate_conversions_count_trigger AFTER INSERT ON public.affiliate_purchases FOR EACH ROW WHEN (((new.status)::text = 'confirmed'::text)) EXECUTE FUNCTION public.update_affiliate_conversions_count();


--
-- Name: affiliate_links update_affiliate_links_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_affiliate_links_updated_at BEFORE UPDATE ON public.affiliate_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: affiliate_products update_affiliate_products_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_affiliate_products_updated_at BEFORE UPDATE ON public.affiliate_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: affiliate_purchases update_affiliate_purchases_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_affiliate_purchases_updated_at BEFORE UPDATE ON public.affiliate_purchases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: post_comments update_comment_replies_count_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_comment_replies_count_trigger AFTER INSERT OR DELETE ON public.post_comments FOR EACH ROW EXECUTE FUNCTION public.update_comment_replies_count();


--
-- Name: content_votes update_content_votes_count_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_content_votes_count_trigger AFTER INSERT OR DELETE OR UPDATE ON public.content_votes FOR EACH ROW EXECUTE FUNCTION public.update_content_votes_count();


--
-- Name: content_votes update_content_votes_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_content_votes_updated_at BEFORE UPDATE ON public.content_votes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: conversations update_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: post_comments update_post_comments_count_delete_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_post_comments_count_delete_trigger AFTER DELETE ON public.post_comments FOR EACH ROW WHEN ((old.parent_id IS NULL)) EXECUTE FUNCTION public.update_post_comments_count();


--
-- Name: post_comments update_post_comments_count_insert_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_post_comments_count_insert_trigger AFTER INSERT ON public.post_comments FOR EACH ROW WHEN ((new.parent_id IS NULL)) EXECUTE FUNCTION public.update_post_comments_count();


--
-- Name: post_comments update_post_comments_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_post_comments_updated_at BEFORE UPDATE ON public.post_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: posts update_posts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reel_comments update_reel_comments_count_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_reel_comments_count_trigger AFTER INSERT OR DELETE ON public.reel_comments FOR EACH ROW EXECUTE FUNCTION public.update_reel_comments_count();


--
-- Name: reel_comments update_reel_comments_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_reel_comments_updated_at BEFORE UPDATE ON public.reel_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reel_views update_reel_views_count_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_reel_views_count_trigger AFTER INSERT ON public.reel_views FOR EACH ROW EXECUTE FUNCTION public.update_reel_views_count();


--
-- Name: reels update_reels_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_reels_updated_at BEFORE UPDATE ON public.reels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: story_views update_story_views_count_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_story_views_count_trigger AFTER INSERT ON public.story_views FOR EACH ROW EXECUTE FUNCTION public.update_story_views_count();


--
-- Name: user_earnings update_user_earnings_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_user_earnings_updated_at BEFORE UPDATE ON public.user_earnings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_interest_map update_user_interest_map_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_user_interest_map_updated_at BEFORE UPDATE ON public.user_interest_map FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_interests update_user_interests_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_user_interests_updated_at BEFORE UPDATE ON public.user_interests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: affiliate_clicks affiliate_clicks_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_clicks
    ADD CONSTRAINT affiliate_clicks_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.affiliate_links(id) ON DELETE CASCADE;


--
-- Name: affiliate_clicks affiliate_clicks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_clicks
    ADD CONSTRAINT affiliate_clicks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: affiliate_links affiliate_links_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_links
    ADD CONSTRAINT affiliate_links_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.affiliate_products(id) ON DELETE CASCADE;


--
-- Name: affiliate_links affiliate_links_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_links
    ADD CONSTRAINT affiliate_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: affiliate_purchases affiliate_purchases_click_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.affiliate_purchases
    ADD CONSTRAINT affiliate_purchases_click_id_fkey FOREIGN KEY (click_id) REFERENCES public.affiliate_clicks(id) ON DELETE CASCADE;


--
-- Name: content_votes content_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.content_votes
    ADD CONSTRAINT content_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_participants conversation_participants_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_participants conversation_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: follows follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: follows follows_following_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: friends friends_friend_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.friends
    ADD CONSTRAINT friends_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: friends friends_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.friends
    ADD CONSTRAINT friends_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages_y2024 messages_y2024_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages_y2024
    ADD CONSTRAINT messages_y2024_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages_y2024 messages_y2024_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages_y2024
    ADD CONSTRAINT messages_y2024_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages_y2025 messages_y2025_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages_y2025
    ADD CONSTRAINT messages_y2025_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages_y2025 messages_y2025_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages_y2025
    ADD CONSTRAINT messages_y2025_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages_y2026 messages_y2026_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages_y2026
    ADD CONSTRAINT messages_y2026_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages_y2026 messages_y2026_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages_y2026
    ADD CONSTRAINT messages_y2026_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: post_comments post_comments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.post_comments(id) ON DELETE CASCADE;


--
-- Name: post_comments post_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_comments post_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: posts posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reel_comments reel_comments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reel_comments
    ADD CONSTRAINT reel_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.reel_comments(id) ON DELETE CASCADE;


--
-- Name: reel_comments reel_comments_reel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reel_comments
    ADD CONSTRAINT reel_comments_reel_id_fkey FOREIGN KEY (reel_id) REFERENCES public.reels(id) ON DELETE CASCADE;


--
-- Name: reel_comments reel_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reel_comments
    ADD CONSTRAINT reel_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reel_views reel_views_reel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reel_views
    ADD CONSTRAINT reel_views_reel_id_fkey FOREIGN KEY (reel_id) REFERENCES public.reels(id) ON DELETE CASCADE;


--
-- Name: reel_views reel_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reel_views
    ADD CONSTRAINT reel_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reels reels_original_reel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reels
    ADD CONSTRAINT reels_original_reel_id_fkey FOREIGN KEY (original_reel_id) REFERENCES public.reels(id) ON DELETE SET NULL;


--
-- Name: reels reels_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reels
    ADD CONSTRAINT reels_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reported_content reported_content_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reported_content
    ADD CONSTRAINT reported_content_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reported_content reported_content_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reported_content
    ADD CONSTRAINT reported_content_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: stories stories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: story_views story_views_story_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT story_views_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(id) ON DELETE CASCADE;


--
-- Name: story_views story_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT story_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_earnings user_earnings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_earnings
    ADD CONSTRAINT user_earnings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_interest_map user_interest_map_interest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_interest_map
    ADD CONSTRAINT user_interest_map_interest_id_fkey FOREIGN KEY (interest_id) REFERENCES public.user_interests(id) ON DELETE CASCADE;


--
-- Name: user_interest_map user_interest_map_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_interest_map
    ADD CONSTRAINT user_interest_map_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: verification_otps verification_otps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.verification_otps
    ADD CONSTRAINT verification_otps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;


--
-- Name: TABLE affiliate_clicks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.affiliate_clicks TO PUBLIC;


--
-- Name: TABLE affiliate_links; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.affiliate_links TO PUBLIC;


--
-- Name: TABLE affiliate_products; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.affiliate_products TO PUBLIC;


--
-- Name: TABLE affiliate_purchases; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.affiliate_purchases TO PUBLIC;


--
-- Name: TABLE content_votes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.content_votes TO PUBLIC;


--
-- Name: TABLE conversation_participants; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.conversation_participants TO PUBLIC;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.conversations TO PUBLIC;


--
-- Name: TABLE follows; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.follows TO PUBLIC;


--
-- Name: TABLE friends; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.friends TO PUBLIC;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.messages TO PUBLIC;


--
-- Name: TABLE messages_y2024; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.messages_y2024 TO PUBLIC;


--
-- Name: TABLE messages_y2025; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.messages_y2025 TO PUBLIC;


--
-- Name: TABLE messages_y2026; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.messages_y2026 TO PUBLIC;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.notifications TO PUBLIC;


--
-- Name: TABLE password_reset_tokens; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.password_reset_tokens TO PUBLIC;


--
-- Name: TABLE post_comments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.post_comments TO PUBLIC;


--
-- Name: TABLE posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.posts TO PUBLIC;


--
-- Name: TABLE reel_comments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reel_comments TO PUBLIC;


--
-- Name: TABLE reel_views; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reel_views TO PUBLIC;


--
-- Name: TABLE reels; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reels TO PUBLIC;


--
-- Name: TABLE reported_content; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reported_content TO PUBLIC;


--
-- Name: TABLE stories; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stories TO PUBLIC;


--
-- Name: TABLE story_views; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.story_views TO PUBLIC;


--
-- Name: TABLE user_earnings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_earnings TO PUBLIC;


--
-- Name: TABLE user_interest_map; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_interest_map TO PUBLIC;


--
-- Name: TABLE user_interests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_interests TO PUBLIC;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO PUBLIC;


--
-- Name: TABLE verification_otps; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.verification_otps TO PUBLIC;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC;


--
-- PostgreSQL database dump complete
--

