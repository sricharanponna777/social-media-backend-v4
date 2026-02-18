const BaseService = require('./base.service');
const db = require('../db/database');

class PostService extends BaseService {
    constructor() {
        super('posts');
    }

    async getFeedPosts(userId, options = {}) {
        const { limit = 20, offset = 0 } = options;

        const query = `
            WITH following_users AS (
                SELECT following_id
                FROM follows
                WHERE follower_id = $1
            )
            SELECT p.*, 
                   u.username, u.full_name, u.avatar_url, u.cover_photo_url, u.is_verified,
                   (
                       SELECT COUNT(*) FROM content_votes cv
                       WHERE cv.content_type = 'post' AND cv.content_id = p.id AND cv.vote_type = 'upvote'
                   ) as total_upvotes,
                   (
                       SELECT COUNT(*) FROM content_votes cv
                       WHERE cv.content_type = 'post' AND cv.content_id = p.id AND cv.vote_type = 'downvote'
                   ) as total_downvotes,
                   (
                       SELECT cv.vote_type
                       FROM content_votes cv
                       WHERE cv.content_type = 'post' AND cv.content_id = p.id AND cv.user_id = $1
                       LIMIT 1
                   ) as user_vote
            FROM posts p
            JOIN users u ON u.id = p.user_id
            WHERE (
                p.user_id IN (SELECT following_id FROM following_users)
                OR p.user_id = $1
            )
            AND p.deleted_at IS NULL
            AND can_view_content($1, p.user_id, p.visibility)
            ORDER BY p.created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await db.query(query, [userId, limit, offset]);
        return result.rows;
    }

    async getUserPosts(profileId, viewerId, options = {}) {
        const { limit = 20, offset = 0 } = options;

        const query = `
            SELECT p.*, 
                   u.username, u.full_name, u.avatar_url, u.cover_photo_url, u.is_verified,
                   (
                       SELECT COUNT(*) FROM content_votes cv
                       WHERE cv.content_type = 'post' AND cv.content_id = p.id AND cv.vote_type = 'upvote'
                   ) as total_upvotes,
                   (
                       SELECT COUNT(*) FROM content_votes cv
                       WHERE cv.content_type = 'post' AND cv.content_id = p.id AND cv.vote_type = 'downvote'
                   ) as total_downvotes,
                   (
                       SELECT cv.vote_type
                       FROM content_votes cv
                       WHERE cv.content_type = 'post' AND cv.content_id = p.id AND cv.user_id = $2
                       LIMIT 1
                   ) as user_vote
            FROM posts p
            JOIN users u ON u.id = p.user_id
            WHERE p.user_id = $1 
            AND p.deleted_at IS NULL
            AND can_view_content($2, p.user_id, p.visibility)
            ORDER BY p.created_at DESC
            LIMIT $3 OFFSET $4
        `;

        const result = await db.query(query, [profileId, viewerId, limit, offset]);
        return result.rows;
    }

    // Like/unlike functionality has been replaced by the reactions system

    async addComment(postId, userId, content, parentId = null) {
        return db.transaction(async (client) => {
            // Insert comment
            const insertQuery = `
                INSERT INTO post_comments (post_id, user_id, parent_id, content)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `;
            
            const result = await client.query(insertQuery, [postId, userId, parentId, content]);
            const comment = result.rows[0];

            // Update comments count if it's a top-level comment
            if (!parentId) {
                await client.query(`
                    UPDATE posts
                    SET comments_count = comments_count + 1
                    WHERE id = $1
                `, [postId]);
            } else {
                // Update parent comment's replies count
                await client.query(`
                    UPDATE post_comments
                    SET replies_count = replies_count + 1
                    WHERE id = $1
                `, [parentId]);
            }

            return comment;
        });
    }

    async deleteComment(commentId, userId) {
        return db.transaction(async (client) => {
            // Get comment info
            const commentQuery = `
                SELECT post_id, parent_id
                FROM post_comments
                WHERE id = $1 AND user_id = $2
            `;
            
            const commentResult = await client.query(commentQuery, [commentId, userId]);
            if (commentResult.rows.length === 0) {
                throw new Error('Comment not found or unauthorized');
            }

            const { post_id, parent_id } = commentResult.rows[0];

            // Delete comment
            await client.query(`
                UPDATE post_comments
                SET deleted_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [commentId]);

            // Update counts
            if (!parent_id) {
                await client.query(`
                    UPDATE posts
                    SET comments_count = GREATEST(comments_count - 1, 0)
                    WHERE id = $1
                `, [post_id]);
            } else {
                await client.query(`
                    UPDATE post_comments
                    SET replies_count = GREATEST(replies_count - 1, 0)
                    WHERE id = $1
                `, [parent_id]);
            }

            return { id: commentId };
        });
    }
}

module.exports = new PostService();
