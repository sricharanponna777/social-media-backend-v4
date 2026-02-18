module.exports = {
  getFriends: `
    SELECT f.id, u.username,
           CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END AS friend_id,
           f.status,
           f.created_at
    FROM friends f
    JOIN users u ON CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END = u.id
    WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
  `,
  getIncomingRequests: `
    SELECT f.*, u.username AS friend_username
    FROM friends f
    JOIN users u ON f.user_id = u.id
    WHERE f.friend_id = $1 AND f.status = 'pending'
  `,
  getOutgoingRequests: `
    SELECT f.*, u.username AS friend_username
    FROM friends f
    JOIN users u ON f.friend_id = u.id
    WHERE f.user_id = $1 AND f.status = 'pending'
  `,
  getFriendshipStatus: `
    SELECT * FROM friends
    WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
  `,
  sendFriendRequest: `
    INSERT INTO friends (user_id, friend_id)
    VALUES ($1, $2)
    RETURNING *
  `,
  acceptFriendRequest: `
    UPDATE friends
    SET status = 'accepted'
    WHERE id = $1
    RETURNING *
  `,
  rejectFriendRequest: `
    UPDATE friends
    SET status = 'rejected'
    WHERE id = $1
    RETURNING *
  `,
  blockFriend: `
    UPDATE friends
    SET status = 'blocked'
    WHERE id = $1
    RETURNING *
  `,
  removeFriend: `
    DELETE FROM friends
    WHERE id = $1
    RETURNING *
  `
};
