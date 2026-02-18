module.exports = {
  GET_NOTIFICATIONS: `
    SELECT * FROM notifications
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `,
  GET_NOTIFICATIONS_WITH_UNREAD: `
    SELECT n.*, stats.unread_count
    FROM (
      SELECT * FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    ) n
    CROSS JOIN (
      SELECT COUNT(*)::int AS unread_count
      FROM notifications
      WHERE user_id = $1 AND is_read = false
    ) stats
  `,
  GET_UNREAD_COUNT: `
    SELECT COUNT(*) FROM notifications
    WHERE user_id = $1 AND is_read = false
  `,
  MARK_AS_READ: `
    UPDATE notifications
    SET is_read = true, read_at = NOW()
    WHERE id = ANY($1::uuid[]) AND user_id = $2
    RETURNING *
  `,
  DELETE_NOTIFICATIONS: `
    DELETE FROM notifications
    WHERE id = ANY($1::uuid[]) AND user_id = $2
    RETURNING *
  `,
  GET_USER_PREFERENCES: `
    SELECT notification_preferences FROM users
    WHERE id = $1
  `,
  UPDATE_PREFERENCES: `
    UPDATE users
    SET notification_preferences = $2
    WHERE id = $1
    RETURNING notification_preferences
  `
};
