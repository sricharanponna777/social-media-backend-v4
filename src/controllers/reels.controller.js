const pool = require('../db/database');
const { AppError } = require('../utils/errors');
const { logger } = require('../utils/logger');
const QUERIES = require('../queries/reels.queries');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

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

        let finalThumbnailUrl = thumbnail_url || null;
        // Attempt server-side thumbnail generation if not provided and media_url is local
        try {
            if (!finalThumbnailUrl && media_url && media_url.startsWith('/uploads/')) {
                const videoAbs = path.join(process.cwd(), media_url.replace(/^\//, ''));
                const thumbDir = path.join(process.cwd(), 'uploads', 'thumbnails');
                if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
                const baseName = path.parse(videoAbs).name + '-' + Date.now() + '.jpg';
                const thumbAbs = path.join(thumbDir, baseName);

                // Use ffmpeg to grab a frame at 1s
                // Requires ffmpeg to be installed on the server
                await execAsync(`ffmpeg -y -ss 00:00:01 -i "${videoAbs}" -frames:v 1 -q:v 2 "${thumbAbs}"`);
                finalThumbnailUrl = `/uploads/thumbnails/${baseName}`;
            }
        } catch (e) {
            // Non-fatal: proceed without thumbnail
            logger.warn(`Thumbnail generation failed: ${e?.message || e}`);
        }

        const result = await pool.query(
            QUERIES.CREATE_REEL,
            [
                req.user.id,
                media_url,
                finalThumbnailUrl,
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
            [limit, offset]
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


    async getComments(req, res) {
        const { id } = req.params;
        const { page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;
        try {
            const result = await pool.query(
                `SELECT c.* FROM reel_comments c WHERE c.reel_id = $1 AND c.deleted_at IS NULL AND c.parent_id IS NULL ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
                [id, limit, offset]
            );
            res.json({ comments: result.rows, page: parseInt(page), limit: parseInt(limit) });
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    }
}
module.exports = new ReelsController();
