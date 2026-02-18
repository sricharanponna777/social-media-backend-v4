module.exports = {
  CREATE_STORY: `
    INSERT INTO stories (user_id, media_url, media_type, caption, duration, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `,
  GET_STORY: `
    SELECT s.*
    FROM stories s
    WHERE s.id = $1
      AND s.deleted_at IS NULL
      AND (
        s.user_id = $2
        OR (
          s.expires_at > NOW()
          AND EXISTS (
            SELECT 1
            FROM friends f
            WHERE (
              (f.user_id = $2 AND f.friend_id = s.user_id)
              OR (f.user_id = s.user_id AND f.friend_id = $2)
            )
            AND f.status = 'accepted'
          )
        )
      )
  `,
  GET_USER_STORIES: `
    SELECT *
    FROM stories s
    WHERE s.user_id = $1
      AND s.deleted_at IS NULL
      AND (
        s.user_id = $2
        OR (
          s.expires_at > NOW()
          AND EXISTS (
            SELECT 1
            FROM friends f
            WHERE (
              (f.user_id = $2 AND f.friend_id = s.user_id)
              OR (f.user_id = s.user_id AND f.friend_id = $2)
            )
            AND f.status = 'accepted'
          )
        )
      )
    ORDER BY created_at DESC
  `,
  GET_FEED_STORIES: `
    WITH accepted_friends AS (
      SELECT
        CASE
          WHEN f.user_id = $1 THEN f.friend_id
          ELSE f.user_id
        END AS friend_id
      FROM friends f
      WHERE (f.user_id = $1 OR f.friend_id = $1)
        AND f.status = 'accepted'
    )
    SELECT
      s.*,
      u.username,
      u.avatar_url,
      u.full_name
    FROM stories s
    JOIN users u ON u.id = s.user_id
    WHERE (
      s.user_id = $1
      OR s.user_id IN (SELECT friend_id FROM accepted_friends)
    )
    AND s.expires_at > NOW()
    AND s.deleted_at IS NULL
    AND u.deleted_at IS NULL
    ORDER BY s.created_at DESC;
  `,
  VIEW_STORY: `
    INSERT INTO story_views (story_id, user_id, view_duration, completed_viewing, device_info, location_data)
    SELECT s.id, $2, $3, $4, $5, $6
    FROM stories s
    WHERE s.id = $1
      AND s.deleted_at IS NULL
      AND (
        s.user_id = $2
        OR (
          s.expires_at > NOW()
          AND EXISTS (
            SELECT 1
            FROM friends f
            WHERE (
              (f.user_id = $2 AND f.friend_id = s.user_id)
              OR (f.user_id = s.user_id AND f.friend_id = $2)
            )
            AND f.status = 'accepted'
          )
        )
      )
    ON CONFLICT (story_id, user_id)
    DO UPDATE SET
      view_duration = GREATEST(COALESCE(story_views.view_duration, 0), COALESCE(EXCLUDED.view_duration, 0)),
      completed_viewing = story_views.completed_viewing OR EXCLUDED.completed_viewing,
      device_info = COALESCE(EXCLUDED.device_info, story_views.device_info),
      location_data = COALESCE(EXCLUDED.location_data, story_views.location_data)
    RETURNING *
  `,
  DELETE_STORY: `
    DELETE FROM stories
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `,
  GET_STORY_STATS: `
    SELECT COUNT(*) FILTER (WHERE completed_viewing) AS completed_views,
           COUNT(*) AS total_views
    FROM story_views
    WHERE story_id = $1
  `
};
