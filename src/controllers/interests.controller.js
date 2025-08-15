const pool = require('../db/database');
const { AppError } = require('../utils/errors');
const { logger } = require('../utils/logger');
const QUERIES = require('../queries/interests.queries');

class InterestsController {
    async listInterests(req, res) {
        const result = await pool.query(QUERIES.LIST_INTERESTS);
        res.json(result.rows);
    }

    async getUserInterests(req, res) {
        const result = await pool.query(
            QUERIES.GET_USER_INTERESTS,
            [req.user.id]
        );
        res.json(result.rows);
    }

    async updateUserInterests(req, res) {
        const { interests } = req.body;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Remove old interests
            await client.query(
                `DELETE FROM user_interest_map WHERE user_id = $1`,
                [req.user.id]
            );

            // Add new interests
            if (interests && interests.length > 0) {
                const values = interests
                    .map((interest, idx) => 
                        `($1, $${idx * 2 + 2}, $${idx * 2 + 3})`
                    )
                    .join(',');

                const params = [req.user.id];
                interests.forEach(interest => {
                    params.push(interest.id, interest.affinity_score || 0.5);
                });

                await client.query(
                    `INSERT INTO user_interest_map (user_id, interest_id, affinity_score)
                     VALUES ${values}`,
                    params
                );
            }

            await client.query('COMMIT');

            const result = await client.query(
                QUERIES.GET_USER_INTERESTS,
                [req.user.id]
            );

            logger.info(`Updated interests for user ${req.user.id}`);
            res.json(result.rows);
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error updating user interests:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async getRecommendedContent(req, res) {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const result = await pool.query(
            QUERIES.GET_RECOMMENDED_CONTENT,
            [req.user.id, limit, offset]
        );

        res.json({
            content: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                hasMore: result.rows.length === limit
            }
        });
    }

    async getSuggestedUsers(req, res) {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const result = await pool.query(
            QUERIES.GET_SUGGESTED_USERS,
            [req.user.id, limit, offset]
        );

        res.json({
            users: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                hasMore: result.rows.length === limit
            }
        });
    }

    async updateInterestAffinity(userId, interestId, score) {
        await pool.query(
            QUERIES.UPDATE_INTEREST_AFFINITY,
            [userId, interestId, score]
        );
        logger.debug(`Updated interest affinity for user ${userId}, interest ${interestId}`);
    }
}

module.exports = new InterestsController();
