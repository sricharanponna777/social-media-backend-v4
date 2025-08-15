const pool = require('../db/database');
const { AppError } = require('../utils/errors');
const { logger } = require('../utils/logger');
const QUERIES = require('../queries/reels.queries');

class ReelsController {
    async createReel(req, res) {
        const {
            media_url,
            thumbnail_url,
            duration,
            caption,
            music_track_url,
            music_track_name,
            music_artist_name
        } = req.body;

        const result = await pool.query(
            QUERIES.CREATE_REEL,
            [
                req.user.id,
                media_url,
                thumbnail_url,
                duration,
                caption,
                music_track_url,
                music_track_name,
                music_artist_name
            ]
        );

        logger.info(`Created new reel for user ${req.user.id}`);
        res.status(201).json(result.rows[0]);
    }

    async getReel(req, res) {
        const { id } = req.params;
        const userId = req.user?.id;

        const result = await pool.query(
            QUERIES.GET_REEL_BY_ID,
            [id, userId]
        );

        if (!result.rows[0]) {
            throw new AppError('Reel not found', 404);
        }

        res.json(result.rows[0]);
    }

    async getFeedReels(req, res) {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const result = await pool.query(
            QUERIES.GET_USER_FEED,
            [req.user.id, limit, offset]
        );

        res.json({
            reels: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                hasMore: result.rows.length === limit
            }
        });
    }

    async getTrendingReels(req, res) {
        const result = await pool.query(QUERIES.GET_TRENDING_REELS);
        res.json(result.rows);
    }

    async addComment(req, res) {
        const { id } = req.params;
        const { content } = req.body;

        const result = await pool.query(
            QUERIES.CREATE_REEL_COMMENT,
            [id, req.user.id, content]
        );

        logger.info(`Added comment to reel ${id} by user ${req.user.id}`);
        res.status(201).json(result.rows[0]);
    }

    async trackView(req, res) {
        const { id } = req.params;
        const { duration } = req.body;

        const result = await pool.query(
            QUERIES.RECORD_VIEW,
            [id, req.user.id, duration]
        );

        logger.info(`Recorded view for reel ${id} by user ${req.user.id}`);
        res.status(200).json(result.rows[0]);
    }
}

module.exports = new ReelsController();
