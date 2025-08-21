module.exports = {
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
    SELECT c.*
    FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id
    WHERE cp.user_id = $1 AND c.deleted_at IS NULL
    ORDER BY c.updated_at DESC
    LIMIT $2 OFFSET $3
  `,
  GET_MESSAGES: `
    SELECT *
    FROM messages
    WHERE conversation_id = $1 AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT $2 OFFSET $3
  `,
  MARK_MESSAGES_READ: `
    UPDATE conversation_participants
    SET last_read_at = NOW()
    WHERE conversation_id = $1 AND user_id = $2
  `,
  GET_UNREAD_COUNT: `
    SELECT cp.conversation_id, COUNT(m.id) AS unread_count
    FROM conversation_participants cp
    JOIN messages m ON m.conversation_id = cp.conversation_id
    WHERE cp.user_id = $1
      AND m.created_at > COALESCE(cp.last_read_at, 'epoch')
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
    WHERE conversation_id = $1 AND user_id = $2
  `,
  CREATE_MESSAGE: `
    INSERT INTO messages (conversation_id, sender_id, message, media_url)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `,
  GET_CONVERSATION_PARTICIPANTS: `
    SELECT user_id
    FROM conversation_participants
    WHERE conversation_id = $1 AND user_id != $2
  `
};
