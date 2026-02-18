module.exports = {
  GET_EXISTING_PRIVATE_CONVERSATION: `
    SELECT c.*
    FROM conversations c
    JOIN conversation_participants cp_self
      ON cp_self.conversation_id = c.id
     AND cp_self.user_id = $1
     AND cp_self.deleted_at IS NULL
    JOIN conversation_participants cp_other
      ON cp_other.conversation_id = c.id
     AND cp_other.user_id = $2
     AND cp_other.deleted_at IS NULL
    WHERE c.type = 'private'
      AND c.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM conversation_participants cp_extra
        WHERE cp_extra.conversation_id = c.id
          AND cp_extra.deleted_at IS NULL
          AND cp_extra.user_id NOT IN ($1, $2)
      )
    ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC
    LIMIT 1
  `,
  CREATE_CONVERSATION: `
    INSERT INTO conversations (creator_id, title, type)
    VALUES ($1, $2, $3)
    RETURNING *
  `,
  ADD_PARTICIPANT: `
    INSERT INTO conversation_participants (conversation_id, user_id, role)
    VALUES ($1, $2, $3)
  `,
  GET_CONVERSATIONS: `
    SELECT
      c.*,
      other_u.id       AS other_user_id,
      other_u.username AS other_username,
      other_u.full_name AS other_full_name,
      last_msg.last_message_id,
      last_msg.last_message_sender_id,
      last_msg.last_message,
      last_msg.last_message_type,
      last_msg.last_message_media_url,
      last_msg.last_message_created_at,
      COALESCE(unread.unread_count, 0) AS unread_count
    FROM conversations c
    JOIN conversation_participants cp_self
      ON cp_self.conversation_id = c.id
     AND cp_self.user_id = $1
     AND cp_self.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT u.id, u.username, u.full_name
      FROM conversation_participants cp2
      JOIN users u ON u.id = cp2.user_id
      WHERE cp2.conversation_id = c.id
        AND cp2.user_id <> $1
        AND cp2.deleted_at IS NULL
      ORDER BY cp2.created_at ASC
      LIMIT 1
    ) other_u ON c.type = 'private'
    LEFT JOIN LATERAL (
      SELECT
        m.id AS last_message_id,
        m.sender_id AS last_message_sender_id,
        m.message AS last_message,
        m.message_type AS last_message_type,
        m.media_url AS last_message_media_url,
        m.created_at AS last_message_created_at
      FROM messages m
      WHERE m.conversation_id = c.id
        AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) last_msg ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(m.id)::int AS unread_count
      FROM messages m
      WHERE m.conversation_id = c.id
        AND m.deleted_at IS NULL
        AND m.sender_id <> $1
        AND m.created_at > COALESCE(cp_self.last_read_at, 'epoch'::timestamptz)
    ) unread ON TRUE
    WHERE c.deleted_at IS NULL
    ORDER BY COALESCE(last_msg.last_message_created_at, c.last_message_at, c.updated_at, c.created_at) DESC
    LIMIT $2 OFFSET $3
  `,
  GET_MESSAGES: `
    WITH page AS (
      SELECT
        m.*,
        u.username AS base_username,
        u.full_name AS base_full_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = $1
        AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $2 OFFSET $3
    ),
    msgs AS (
      SELECT
        page.*,
        LAG(page.sender_id) OVER (ORDER BY page.created_at ASC, page.id ASC) AS prev_sender_id
      FROM page
    )
    SELECT
           msgs.*,
           CASE WHEN msgs.prev_sender_id IS NULL OR msgs.prev_sender_id <> msgs.sender_id
                THEN msgs.base_username ELSE NULL END AS sender_username,
           CASE WHEN msgs.prev_sender_id IS NULL OR msgs.prev_sender_id <> msgs.sender_id
                THEN msgs.base_full_name ELSE NULL END AS sender_full_name
    FROM msgs
    ORDER BY msgs.created_at ASC, msgs.id ASC
  `,
  MARK_MESSAGES_READ: `
    UPDATE conversation_participants
    SET last_read_at = NOW()
    WHERE conversation_id = $1 AND user_id = $2
  `,
  GET_UNREAD_COUNT: `
    SELECT cp.conversation_id, COUNT(m.id)::int AS unread_count
    FROM conversation_participants cp
    JOIN messages m ON m.conversation_id = cp.conversation_id
    WHERE cp.user_id = $1
      AND cp.deleted_at IS NULL
      AND m.sender_id <> $1
      AND m.created_at > COALESCE(cp.last_read_at, 'epoch'::timestamptz)
      AND m.deleted_at IS NULL
    GROUP BY cp.conversation_id
  `,
  DELETE_MESSAGE: `
    DELETE FROM messages
    WHERE id = $1 AND sender_id = $2
    RETURNING *
  `,
  CHECK_PARTICIPANT: `
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = $1 AND user_id = $2 AND deleted_at IS NULL
  `,
  CREATE_MESSAGE: `
    INSERT INTO messages (conversation_id, sender_id, message, media_url)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `,
  GET_CONVERSATION_PARTICIPANTS: `
    SELECT user_id
    FROM conversation_participants
    WHERE conversation_id = $1
      AND user_id != $2
      AND deleted_at IS NULL
  `,
  UPDATE_CONVERSATION_ACTIVITY: `
    UPDATE conversations
    SET last_message_at = COALESCE($2, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND deleted_at IS NULL
    RETURNING id, last_message_at, updated_at
  `,
  GET_CONVERSATION: `
    SELECT id, type, title
    FROM conversations
    WHERE id = $1 AND deleted_at IS NULL
  `,
  GET_OTHER_PARTICIPANT: `
    SELECT u.id, u.username, u.full_name
    FROM conversation_participants cp
    JOIN users u ON u.id = cp.user_id
    WHERE cp.conversation_id = $1
      AND cp.user_id <> $2
      AND cp.deleted_at IS NULL
    ORDER BY cp.created_at ASC
    LIMIT 1
  `
};
