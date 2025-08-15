const BaseService = require('./base.service');
const db = require('../db/database');

class UserService extends BaseService {
    constructor() {
        super('users');
    }

    async findByEmail(email) {
        return this.findOne({ email });
    }

    async findByUsername(username) {
        return this.findOne({ username });
    }

    async updateLastActive(userId) {
        return this.update(userId, { last_active_at: new Date() });
    }

    async getFollowers(userId, options = {}) {
        const { limit = 20, offset = 0 } = options;
        
        const query = `
            SELECT u.*
            FROM users u
            INNER JOIN follows f ON f.follower_id = u.id
            WHERE f.following_id = $1 AND f.status = 'accepted'
            AND u.deleted_at IS NULL
            ORDER BY f.created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await db.query(query, [userId, limit, offset]);
        return result.rows;
    }

    async getFollowing(userId, options = {}) {
        const { limit = 20, offset = 0 } = options;
        
        const query = `
            SELECT u.*
            FROM users u
            INNER JOIN follows f ON f.following_id = u.id
            WHERE f.follower_id = $1 AND f.status = 'accepted'
            AND u.deleted_at IS NULL
            ORDER BY f.created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await db.query(query, [userId, limit, offset]);
        return result.rows;
    }

    async follow(followerId, followingId) {
        return db.transaction(async (client) => {
            // Check if users exist and not following already
            const checkQuery = `
                SELECT 1
                FROM follows
                WHERE follower_id = $1 AND following_id = $2
            `;
            const checkResult = await client.query(checkQuery, [followerId, followingId]);
            
            if (checkResult.rows.length > 0) {
                throw new Error('Already following this user');
            }

            // Create follow relationship
            const query = `
                INSERT INTO follows (follower_id, following_id, status)
                VALUES ($1, $2, 
                    CASE 
                        WHEN (SELECT is_private FROM users WHERE id = $2) THEN 'pending'
                        ELSE 'accepted'
                    END
                )
                RETURNING *
            `;
            
            const result = await client.query(query, [followerId, followingId]);
            return result.rows[0];
        });
    }

    async unfollow(followerId, followingId) {
        const query = `
            DELETE FROM follows
            WHERE follower_id = $1 AND following_id = $2
            RETURNING *
        `;
        
        const result = await db.query(query, [followerId, followingId]);
        return result.rows[0];
    }

    async acceptFollowRequest(userId, followerId) {
        const query = `
            UPDATE follows
            SET status = 'accepted'
            WHERE following_id = $1 AND follower_id = $2 AND status = 'pending'
            RETURNING *
        `;
        
        const result = await db.query(query, [userId, followerId]);
        return result.rows[0];
    }

    async rejectFollowRequest(userId, followerId) {
        const query = `
            DELETE FROM follows
            WHERE following_id = $1 AND follower_id = $2 AND status = 'pending'
            RETURNING *
        `;
        
        const result = await db.query(query, [userId, followerId]);
        return result.rows[0];
    }
}

module.exports = new UserService();
