const db = require('../db/database');
const storyQueries = require('../queries/stories.queries');
const fileService = require('../services/file.service');
const notificationService = require('../services/notification.service');

class StoryController {
    async createStory(req, res) {
        try {
            let mediaUrl;
            if (req.files && req.files.length > 0) {
                const uploadResult = await fileService.uploadFile(req.files[0]);
                mediaUrl = uploadResult.url;
            } else if (req.body.mediaBase64) {
                const uploadResult = await fileService.uploadBase64File(
                    req.body.mediaBase64,
                    'story.' + (req.body.mediaType === 'video' ? 'mp4' : 'jpg')
                );
                mediaUrl = uploadResult.url;
            } else {
                return res.status(400).json({ error: 'Media content is required' });
            }

            const result = await db.query(storyQueries.CREATE_STORY, [
                req.user.id,
                mediaUrl,
                req.body.mediaType,
                req.body.caption,
                req.body.duration || 5,
            ]);

            // Get user's followers to notify them
            const followersResult = await db.query(`
                SELECT follower_id
                FROM follows
                WHERE following_id = $1 AND status = 'accepted'
            `, [req.user.id]);

            // Create notifications for followers
            await Promise.all(followersResult.rows.map(follower =>
                notificationService.createNotification({
                    user_id: follower.follower_id,
                    actor_id: req.user.id,
                    type: 'new_story',
                    target_type: 'story',
                    target_id: result.rows[0].id,
                    message: 'added a new story'
                })
            ));

            res.status(201).json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getStory(req, res) {
        try {
            const result = await db.query(storyQueries.GET_STORY, [
                req.params.id,
                req.user.id
            ]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Story not found or expired' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getUserStories(req, res) {
        try {
            const result = await db.query(storyQueries.GET_USER_STORIES, [
                req.params.userId,
                req.user.id
            ]);

            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getFeedStories(req, res) {
        try {
            const result = await db.query(storyQueries.GET_FEED_STORIES, [req.user.id]);
            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async viewStory(req, res) {
        const { storyId } = req.params;
        const { viewDuration, completed = false, deviceInfo = {}, locationData = {} } = req.body;

        try {
            const result = await db.query(storyQueries.VIEW_STORY, [
                storyId,
                req.user.id,
                viewDuration,
                completed,
                deviceInfo,
                locationData
            ]);

            res.json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async deleteStory(req, res) {
        try {
            const result = await db.query(storyQueries.DELETE_STORY, [
                req.params.id,
                req.user.id
            ]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Story not found or unauthorized' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getStoryStats(req, res) {
        try {
            // Verify story ownership
            const storyResult = await db.query(`
                SELECT 1 FROM stories WHERE id = $1 AND user_id = $2
            `, [req.params.id, req.user.id]);

            if (storyResult.rows.length === 0) {
                return res.status(404).json({ error: 'Story not found or unauthorized' });
            }

            const result = await db.query(storyQueries.GET_STORY_STATS, [req.params.id]);
            res.json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new StoryController();
