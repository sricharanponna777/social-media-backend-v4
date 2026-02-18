module.exports = {
  UPSERT_VOTE: `
    INSERT INTO content_votes (user_id, content_type, content_id, vote_type)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, content_type, content_id)
    DO UPDATE SET
      vote_type = EXCLUDED.vote_type,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `,
  REMOVE_VOTE: `
    DELETE FROM content_votes
    WHERE user_id = $1 AND content_type = $2 AND content_id = $3
    RETURNING *
  `,
  GET_VOTES: `
    SELECT
      cv.*,
      u.username,
      u.avatar_url,
      u.cover_photo_url
    FROM content_votes cv
    JOIN users u ON u.id = cv.user_id
    WHERE cv.content_type = $1 AND cv.content_id = $2
    ORDER BY cv.created_at DESC
  `,
  GET_COUNTS: `
    SELECT
      vote_type,
      COUNT(*)::int AS count
    FROM content_votes
    WHERE content_type = $1 AND content_id = $2
    GROUP BY vote_type
    ORDER BY vote_type ASC
  `,
  GET_USER_VOTE: `
    SELECT vote_type
    FROM content_votes
    WHERE user_id = $1 AND content_type = $2 AND content_id = $3
    LIMIT 1
  `,
  GET_POST_OWNER: `
    SELECT user_id
    FROM posts
    WHERE id = $1 AND deleted_at IS NULL
  `,
  GET_COMMENT_OWNER: `
    SELECT user_id FROM post_comments WHERE id = $1 AND deleted_at IS NULL
    UNION ALL
    SELECT user_id FROM reel_comments WHERE id = $1 AND deleted_at IS NULL
    LIMIT 1
  `,
  GET_STORY_OWNER: `
    SELECT user_id
    FROM stories
    WHERE id = $1 AND deleted_at IS NULL
  `,
  GET_REEL_OWNER: `
    SELECT user_id
    FROM reels
    WHERE id = $1 AND deleted_at IS NULL
  `,
}
