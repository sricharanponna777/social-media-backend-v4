module.exports = {
  CREATE_POST: `
    INSERT INTO posts (user_id, content, media_urls, visibility)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `,
  GET_POST: `
    SELECT p.*, p.upvotes_count AS likes_count, u.*,
           (p.visibility = 'public' OR p.user_id = $2) AS can_view
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = $1 AND p.deleted_at IS NULL
  `,
  GET_POST_COMMENTS: `
    SELECT c.*
    FROM post_comments c
    WHERE c.post_id = $1 AND c.deleted_at IS NULL AND c.parent_id IS NULL
    ORDER BY c.created_at DESC
    LIMIT $2 OFFSET $3
  `,
  CREATE_POST_COMMENT: `
    INSERT INTO post_comments (post_id, user_id, parent_id, content)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `,
  GET_FEED_POSTS: `
    SELECT p.*, p.upvotes_count AS likes_count, u.username, u.avatar_url, u.id AS user_id, u.full_name
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.deleted_at IS NULL
      AND (p.visibility = 'public' OR p.user_id = $1)
    ORDER BY p.created_at DESC
    LIMIT $2 OFFSET $3
  `,
  GET_USER_POSTS: `
    SELECT p.*, p.upvotes_count AS likes_count
    FROM posts p
    WHERE p.user_id = $1
      AND (p.visibility = 'public' OR p.user_id = $2)
      AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
    LIMIT $3 OFFSET $4
  `,
  DELETE_POST: `
    DELETE FROM posts
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `
};
