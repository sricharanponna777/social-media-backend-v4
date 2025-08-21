module.exports = {
  CREATE_POST: `
    INSERT INTO posts (user_id, content, media_urls, visibility)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `,
  GET_POST: `
    SELECT p.*,
           (p.visibility = 'public' OR p.user_id = $2) AS can_view
    FROM posts p
    WHERE p.id = $1 AND p.deleted_at IS NULL
  `,
  GET_FEED_POSTS: `
    SELECT p.*
    FROM posts p
    WHERE p.deleted_at IS NULL
      AND (p.visibility = 'public' OR p.user_id = $1)
    ORDER BY p.created_at DESC
    LIMIT $2 OFFSET $3
  `,
  GET_USER_POSTS: `
    SELECT p.*
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
