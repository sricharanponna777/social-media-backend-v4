const BaseService = require('./base.service');
const db = require('../db/database');
const socketService = global.socketService;

class NotificationService extends BaseService {
    constructor() {
        super('notifications');
    }

    async getUserNotifications(userId, options = {}) {
        const { limit = 20, offset = 0 } = options;

        const query = `
            SELECT n.*, 
                   a.username as actor_username, 
                   a.avatar_url as actor_avatar_url
                   a.cover_photo_url as actor_cover_photo_url
            FROM notifications n
            LEFT JOIN users a ON a.id = n.actor_id
            WHERE n.user_id = $1
            ORDER BY n.created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await db.query(query, [userId, limit, offset]);
        return result.rows;
    }

    async getUnreadCount(userId) {
        const query = `
            SELECT COUNT(*) as count
            FROM notifications
            WHERE user_id = $1 AND is_read = false
        `;

        const result = await db.query(query, [userId]);
        return parseInt(result.rows[0].count);
    }

    async markAsRead(notificationIds, userId) {
        const query = `
            UPDATE notifications
            SET is_read = true,
                read_at = CURRENT_TIMESTAMP
            WHERE id = ANY($1) AND user_id = $2
            RETURNING *
        `;

        const result = await db.query(query, [notificationIds, userId]);
        return result.rows;
    }

    async createNotification(data) {
        const notification = await this.create(data);

        // Send real-time notification if user is online
        if (socketService) {
            socketService.emitToUser(data.user_id, 'new_notification', notification);
        }

        return notification;
    }

    // Utility methods for different notification types
    async notifyFollow(followerId, followingId) {
        return this.createNotification({
            user_id: followingId,
            actor_id: followerId,
            type: 'follow_request',
            message: 'started following you'
        });
    }

    // Legacy method - kept for backward compatibility
    async notifyLike(userId, postId, postOwnerId) {
        return this.notifyReaction(userId, 'post', postId, postOwnerId, 'like');
    }
    
    /**
     * Notify a user about a reaction to their content
     * @param {number} userId - The ID of the user who reacted
     * @param {string} contentType - The type of content ('post', 'comment', 'story', 'reel')
     * @param {number} contentId - The ID of the content
     * @param {number} contentOwnerId - The ID of the content owner
     * @param {string} reactionName - The name of the reaction (like, love, etc.)
     * @returns {Promise<Object>} The created notification
     */
    async notifyReaction(userId, contentType, contentId, contentOwnerId, reactionName) {
        // Don't notify if user is reacting to their own content
        if (userId === contentOwnerId) {
            return null;
        }
        
        return this.createNotification({
            user_id: contentOwnerId,
            actor_id: userId,
            type: `${contentType}_reaction`,
            target_type: contentType,
            target_id: contentId,
            message: `reacted with ${reactionName} to your ${contentType}`,
            metadata: { reaction: reactionName }
        });
    }

    async notifyComment(userId, postId, postOwnerId) {
        return this.createNotification({
            user_id: postOwnerId,
            actor_id: userId,
            type: 'post_comment',
            target_type: 'post',
            target_id: postId,
            message: 'commented on your post'
        });
    }

    async notifyMention(mentionedByUserId, mentionedUserId, postId) {
        return this.createNotification({
            user_id: mentionedUserId,
            actor_id: mentionedByUserId,
            type: 'mention',
            target_type: 'post',
            target_id: postId,
            message: 'mentioned you in a post'
        });
    }
}

module.exports = new NotificationService();
