const pool = require('../db/database');
const { AppError } = require('../utils/errors');
const { logger } = require('../utils/logger');
const notificationService = require('../services/notification.service');

class ReactionsController {
    async addReaction(req, res) {
        const { content_type, content_id, reaction_id } = req.body;
        
        try {
            // Validate content type
            if (!['post', 'comment', 'story', 'reel'].includes(content_type)) {
                return res.status(400).json({ error: 'Invalid content type' });
            }

            // Check if content exists
            let contentExists = false;
            let contentOwnerId = null;
            
            switch(content_type) {
                case 'post':
                    const postResult = await pool.query(
                        'SELECT user_id FROM posts WHERE id = $1 AND deleted_at IS NULL',
                        [content_id]
                    );
                    contentExists = postResult.rows.length > 0;
                    if (contentExists) contentOwnerId = postResult.rows[0].user_id;
                    break;
                case 'comment':
                    const commentResult = await pool.query(
                        'SELECT user_id FROM comments WHERE id = $1 AND deleted_at IS NULL',
                        [content_id]
                    );
                    contentExists = commentResult.rows.length > 0;
                    if (contentExists) contentOwnerId = commentResult.rows[0].user_id;
                    break;
                case 'story':
                    const storyResult = await pool.query(
                        'SELECT user_id FROM stories WHERE id = $1 AND deleted_at IS NULL',
                        [content_id]
                    );
                    contentExists = storyResult.rows.length > 0;
                    if (contentExists) contentOwnerId = storyResult.rows[0].user_id;
                    break;
                case 'reel':
                    const reelResult = await pool.query(
                        'SELECT user_id FROM reels WHERE id = $1 AND deleted_at IS NULL',
                        [content_id]
                    );
                    contentExists = reelResult.rows.length > 0;
                    if (contentExists) contentOwnerId = reelResult.rows[0].user_id;
                    break;
            }

            if (!contentExists) {
                return res.status(404).json({ error: 'Content not found' });
            }

            // Check if reaction exists
            const reactionResult = await pool.query(
                'SELECT id, name FROM reactions WHERE id = $1',
                [reaction_id]
            );

            if (reactionResult.rows.length === 0) {
                return res.status(404).json({ error: 'Reaction not found' });
            }

            const reactionName = reactionResult.rows[0].name;

            // Add reaction (this will replace any existing reaction from this user on this content)
            await pool.query(
                `INSERT INTO content_reactions (user_id, reaction_id, content_type, content_id)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (user_id, content_type, content_id) 
                DO UPDATE SET reaction_id = $2, created_at = CURRENT_TIMESTAMP
                RETURNING *`,
                [req.user.id, reaction_id, content_type, content_id]
            );

            // Notify content owner if it's not the user's own content
            if (contentOwnerId && contentOwnerId !== req.user.id) {
                await notificationService.createNotification({
                    user_id: contentOwnerId,
                    actor_id: req.user.id,
                    type: `${content_type}_reaction`,
                    target_type: content_type,
                    target_id: content_id,
                    message: `reacted with ${reactionName} to your ${content_type}`
                });
            }

            logger.info(`User ${req.user.id} reacted to ${content_type} ${content_id}`);
            res.status(201).json({ success: true });
        } catch (error) {
            logger.error(`Error adding reaction: ${error.message}`);
            res.status(500).json({ error: 'Server error' });
        }
    }

    async removeReaction(req, res) {
        const { content_type, content_id } = req.params;
        
        try {
            // Validate content type
            if (!['post', 'comment', 'story', 'reel'].includes(content_type)) {
                return res.status(400).json({ error: 'Invalid content type' });
            }

            // Remove reaction
            const result = await pool.query(
                `DELETE FROM content_reactions 
                WHERE user_id = $1 AND content_type = $2 AND content_id = $3
                RETURNING *`,
                [req.user.id, content_type, content_id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Reaction not found' });
            }

            logger.info(`User ${req.user.id} removed reaction from ${content_type} ${content_id}`);
            res.status(204).send();
        } catch (error) {
            logger.error(`Error removing reaction: ${error.message}`);
            res.status(500).json({ error: 'Server error' });
        }
    }

    async getReactions(req, res) {
        const { content_type, content_id } = req.params;
        
        try {
            // Validate content type
            if (!['post', 'comment', 'story', 'reel'].includes(content_type)) {
                return res.status(400).json({ error: 'Invalid content type' });
            }

            // Get reactions with user info
            const result = await pool.query(
                `SELECT cr.*, r.name as reaction_name, r.icon_url, 
                        u.username, u.avatar_url, u.cover_photo_url
                FROM content_reactions cr
                JOIN reactions r ON cr.reaction_id = r.id
                JOIN users u ON cr.user_id = u.id
                WHERE cr.content_type = $1 AND cr.content_id = $2
                ORDER BY cr.created_at DESC`,
                [content_type, content_id]
            );

            // Get reaction counts by type
            const countResult = await pool.query(
                `SELECT r.name, COUNT(*) as count
                FROM content_reactions cr
                JOIN reactions r ON cr.reaction_id = r.id
                WHERE cr.content_type = $1 AND cr.content_id = $2
                GROUP BY r.name
                ORDER BY count DESC`,
                [content_type, content_id]
            );

            res.json({
                reactions: result.rows,
                counts: countResult.rows,
                total: result.rows.length
            });
        } catch (error) {
            logger.error(`Error getting reactions: ${error.message}`);
            res.status(500).json({ error: 'Server error' });
        }
    }
}

module.exports = new ReactionsController();