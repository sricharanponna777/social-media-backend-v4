const db = require('../db');
const { NotFoundError, BadRequestError } = require('../utils/errors');

/**
 * Service for handling content reactions
 */
class ReactionService {
  /**
   * Add or update a reaction to content
   * @param {number} userId - The ID of the user adding the reaction
   * @param {string} contentType - The type of content ('post', 'comment', 'story', 'reel')
   * @param {number} contentId - The ID of the content
   * @param {number} reactionId - The ID of the reaction
   * @returns {Promise<Object>} The added reaction
   */
  static async addReaction(userId, contentType, contentId, reactionId) {
    // Validate content type
    if (!['post', 'comment', 'story', 'reel'].includes(contentType)) {
      throw new BadRequestError(`Invalid content type: ${contentType}`);
    }

    // Verify reaction exists
    const reactionExists = await db.query(
      'SELECT id FROM reactions WHERE id = $1',
      [reactionId]
    );

    if (reactionExists.rows.length === 0) {
      throw new NotFoundError(`Reaction with ID ${reactionId} not found`);
    }

    // Verify content exists based on content type
    let contentExists;
    switch (contentType) {
      case 'post':
        contentExists = await db.query('SELECT id FROM posts WHERE id = $1', [contentId]);
        break;
      case 'comment':
        contentExists = await db.query('SELECT id FROM post_comments WHERE id = $1', [contentId]);
        break;
      case 'story':
        contentExists = await db.query('SELECT id FROM stories WHERE id = $1', [contentId]);
        break;
      case 'reel':
        contentExists = await db.query('SELECT id FROM reels WHERE id = $1', [contentId]);
        break;
    }

    if (contentExists.rows.length === 0) {
      throw new NotFoundError(`${contentType} with ID ${contentId} not found`);
    }

    // Add or update reaction
    const result = await db.query(
      `INSERT INTO content_reactions (user_id, reaction_id, content_type, content_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, content_type, content_id)
       DO UPDATE SET reaction_id = $2, created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, reactionId, contentType, contentId]
    );

    return result.rows[0];
  }

  /**
   * Remove a reaction from content
   * @param {number} userId - The ID of the user removing the reaction
   * @param {string} contentType - The type of content ('post', 'comment', 'story', 'reel')
   * @param {number} contentId - The ID of the content
   * @returns {Promise<boolean>} True if reaction was removed, false if no reaction existed
   */
  static async removeReaction(userId, contentType, contentId) {
    // Validate content type
    if (!['post', 'comment', 'story', 'reel'].includes(contentType)) {
      throw new BadRequestError(`Invalid content type: ${contentType}`);
    }

    const result = await db.query(
      `DELETE FROM content_reactions
       WHERE user_id = $1 AND content_type = $2 AND content_id = $3
       RETURNING id`,
      [userId, contentType, contentId]
    );

    return result.rows.length > 0;
  }

  /**
   * Get all reactions for a piece of content
   * @param {string} contentType - The type of content ('post', 'comment', 'story', 'reel')
   * @param {number} contentId - The ID of the content
   * @param {number} [userId] - Optional user ID to check if they've reacted
   * @returns {Promise<Object>} Object containing reaction counts and user reaction
   */
  static async getReactions(contentType, contentId, userId = null) {
    // Validate content type
    if (!['post', 'comment', 'story', 'reel'].includes(contentType)) {
      throw new BadRequestError(`Invalid content type: ${contentType}`);
    }

    // Get total reactions count
    const totalResult = await db.query(
      `SELECT COUNT(*) as total_count
       FROM content_reactions
       WHERE content_type = $1 AND content_id = $2`,
      [contentType, contentId]
    );
    
    const totalCount = parseInt(totalResult.rows[0]?.total_count || 0);

    // Get reaction counts by reaction type
    const countsResult = await db.query(
      `SELECT r.id, r.name, r.icon_url, COUNT(cr.id) as count
       FROM reactions r
       LEFT JOIN content_reactions cr ON r.id = cr.reaction_id
         AND cr.content_type = $1 AND cr.content_id = $2
       GROUP BY r.id
       ORDER BY count DESC, r.name ASC`,
      [contentType, contentId]
    );

    // Get user's reaction if userId is provided
    let userReaction = null;
    if (userId) {
      const userResult = await db.query(
        `SELECT cr.id, cr.reaction_id, r.name, r.icon_url
         FROM content_reactions cr
         JOIN reactions r ON cr.reaction_id = r.id
         WHERE cr.user_id = $1 AND cr.content_type = $2 AND cr.content_id = $3`,
        [userId, contentType, contentId]
      );

      if (userResult.rows.length > 0) {
        userReaction = userResult.rows[0];
      }
    }

    // Get recent reactors (limit to 5)
    const recentReactorsResult = await db.query(
      `SELECT u.id, u.username, u.profile_picture, cr.reaction_id, r.name as reaction_name
       FROM content_reactions cr
       JOIN users u ON cr.user_id = u.id
       JOIN reactions r ON cr.reaction_id = r.id
       WHERE cr.content_type = $1 AND cr.content_id = $2
       ORDER BY cr.created_at DESC
       LIMIT 5`,
      [contentType, contentId]
    );

    return {
      total_count: totalCount,
      reaction_counts: countsResult.rows,
      user_reaction: userReaction,
      recent_reactors: recentReactorsResult.rows
    };
  }

  /**
   * Get all available reaction types
   * @returns {Promise<Array>} Array of reaction types
   */
  static async getReactionTypes() {
    const result = await db.query(
      'SELECT id, name, icon_url FROM reactions ORDER BY id'
    );

    return result.rows;
  }
}

module.exports = ReactionService;