module.exports = {
  CREATE_STORY: `
    INSERT INTO stories (user_id, media_url, media_type, caption, duration)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `,
  GET_STORY: `
    SELECT s.*
    FROM stories s
    WHERE s.id = $1 AND (s.user_id = $2 OR s.expires_at > NOW())
  `,
  GET_USER_STORIES: `
    SELECT * FROM stories
    WHERE user_id = $1 AND (user_id = $2 OR expires_at > NOW())
    ORDER BY created_at DESC
  `,
  GET_FEED_STORIES: `
    SELECT s.*
    FROM stories s
    JOIN follows f ON f.following_id = s.user_id
    WHERE f.follower_id = $1 AND s.expires_at > NOW()
    ORDER BY s.created_at DESC
  `,
  VIEW_STORY: `
    INSERT INTO story_views (story_id, user_id, view_duration, completed, device_info, location_data)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `,
  DELETE_STORY: `
    DELETE FROM stories
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `,
  GET_STORY_STATS: `
    SELECT COUNT(*) FILTER (WHERE completed) AS completed_views,
           COUNT(*) AS total_views
    FROM story_views
    WHERE story_id = $1
  `
};
