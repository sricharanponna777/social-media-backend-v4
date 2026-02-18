module.exports = {
  CREATE_REEL: `
    INSERT INTO reels (user_id, media_url, thumbnail_url, duration, caption, music_track_url, music_track_name, music_artist_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `,
  GET_REEL_BY_ID: `
    SELECT r.*, r.upvotes_count AS likes_count
    FROM reels r
    WHERE r.id = $1 AND r.deleted_at IS NULL
  `,
  GET_USER_FEED: `
    SELECT r.*, r.upvotes_count AS likes_count, u.username, u.avatar_url, u.full_name
    FROM reels r
    JOIN users u ON r.user_id = u.id
    WHERE r.deleted_at IS NULL
    AND u.deleted_at IS NULL
    ORDER BY r.created_at DESC
    LIMIT $1 OFFSET $2
  `,
  GET_TRENDING_REELS: `
    SELECT r.*, r.upvotes_count AS likes_count
    FROM reels r
    WHERE r.deleted_at IS NULL
    ORDER BY r.views_count DESC
    LIMIT 20
  `,
  CREATE_REEL_COMMENT: `
    INSERT INTO reel_comments (reel_id, user_id, content)
    VALUES ($1, $2, $3)
    RETURNING *
  `,
  RECORD_VIEW: `
    INSERT INTO reel_views (reel_id, user_id, watch_duration)
    VALUES ($1, $2, $3)
    ON CONFLICT (reel_id, user_id)
      DO UPDATE SET watch_duration = EXCLUDED.watch_duration
    RETURNING *
  `
};
