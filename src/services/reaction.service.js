const db = require('../db/database')
const { BadRequestError } = require('../utils/errors')

const VALID_CONTENT_TYPES = new Set(['post', 'comment', 'story', 'reel'])

function normalizeVoteType(input) {
  const value = String(input ?? '').trim().toLowerCase()
  if (value === 'downvote' || value === 'dislike' || value === 'angry' || value === '6') {
    return 'downvote'
  }
  return 'upvote'
}

/**
 * Legacy compatibility service kept under the old name.
 * Internally this now writes/reads content_votes.
 */
class ReactionService {
  static async addReaction(userId, contentType, contentId, reactionIdOrType) {
    if (!VALID_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestError(`Invalid content type: ${contentType}`)
    }

    const voteType = normalizeVoteType(reactionIdOrType)
    const result = await db.query(
      `INSERT INTO content_votes (user_id, vote_type, content_type, content_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, content_type, content_id)
       DO UPDATE SET vote_type = EXCLUDED.vote_type, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, voteType, contentType, contentId]
    )

    return result.rows[0]
  }

  static async removeReaction(userId, contentType, contentId) {
    if (!VALID_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestError(`Invalid content type: ${contentType}`)
    }

    const result = await db.query(
      `DELETE FROM content_votes
       WHERE user_id = $1 AND content_type = $2 AND content_id = $3
       RETURNING id`,
      [userId, contentType, contentId]
    )

    return result.rows.length > 0
  }

  static async getReactions(contentType, contentId, userId = null) {
    if (!VALID_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestError(`Invalid content type: ${contentType}`)
    }

    const totalResult = await db.query(
      `SELECT COUNT(*)::int AS total_count
       FROM content_votes
       WHERE content_type = $1 AND content_id = $2`,
      [contentType, contentId]
    )
    const totalCount = totalResult.rows[0]?.total_count || 0

    const countsResult = await db.query(
      `SELECT vote_type AS name, COUNT(*)::int AS count
       FROM content_votes
       WHERE content_type = $1 AND content_id = $2
       GROUP BY vote_type
       ORDER BY vote_type ASC`,
      [contentType, contentId]
    )

    let userReaction = null
    if (userId) {
      const userResult = await db.query(
        `SELECT vote_type AS name
         FROM content_votes
         WHERE user_id = $1 AND content_type = $2 AND content_id = $3
         LIMIT 1`,
        [userId, contentType, contentId]
      )
      if (userResult.rows.length > 0) {
        userReaction = userResult.rows[0]
      }
    }

    const recentReactorsResult = await db.query(
      `SELECT
         u.id,
         u.username,
         u.avatar_url AS profile_picture,
         cv.vote_type AS reaction_name
       FROM content_votes cv
       JOIN users u ON cv.user_id = u.id
       WHERE cv.content_type = $1 AND cv.content_id = $2
       ORDER BY cv.updated_at DESC
       LIMIT 5`,
      [contentType, contentId]
    )

    return {
      total_count: totalCount,
      reaction_counts: countsResult.rows,
      user_reaction: userReaction,
      recent_reactors: recentReactorsResult.rows,
    }
  }

  static async getReactionTypes() {
    return [
      { id: 'upvote', name: 'upvote', icon_url: null },
      { id: 'downvote', name: 'downvote', icon_url: null },
    ]
  }
}

module.exports = ReactionService
