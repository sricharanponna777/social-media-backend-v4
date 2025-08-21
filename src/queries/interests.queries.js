module.exports = {
  LIST_INTERESTS: `
    SELECT * FROM user_interests
    ORDER BY name
  `,
  GET_USER_INTERESTS: `
    SELECT ui.id, ui.name, ui.display_name, uim.affinity_score
    FROM user_interest_map uim
    JOIN user_interests ui ON ui.id = uim.interest_id
    WHERE uim.user_id = $1
  `,
  GET_RECOMMENDED_CONTENT: `
    SELECT p.*
    FROM posts p
    WHERE p.visibility = 'public'
    ORDER BY p.created_at DESC
    LIMIT $2 OFFSET $3
  `,
  GET_SUGGESTED_USERS: `
    SELECT u.id, u.username, u.avatar_url, u.cover_photo_url
    FROM users u
    WHERE u.id != $1 AND u.deleted_at IS NULL
    ORDER BY u.created_at DESC
    LIMIT $2 OFFSET $3
  `,
  UPDATE_INTEREST_AFFINITY: `
    UPDATE user_interest_map
    SET affinity_score = $3
    WHERE user_id = $1 AND interest_id = $2
  `
};
