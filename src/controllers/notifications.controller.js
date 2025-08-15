const db = require('../db/database');
const notificationQueries = require('../queries/notifications.queries');

class NotificationController {
    async getNotifications(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        try {
            const result = await db.query(notificationQueries.GET_NOTIFICATIONS, [
                req.user.id,
                limit,
                offset
            ]);

            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getUnreadCount(req, res) {
        try {
            const result = await db.query(notificationQueries.GET_UNREAD_COUNT, [req.user.id]);
            res.json({ count: parseInt(result.rows[0].count) });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async markAsRead(req, res) {
        const { notificationIds } = req.body;

        try {
            const result = await db.query(notificationQueries.MARK_AS_READ, [
                notificationIds,
                req.user.id
            ]);

            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async deleteNotifications(req, res) {
        const { notificationIds } = req.body;

        try {
            const result = await db.query(notificationQueries.DELETE_NOTIFICATIONS, [
                notificationIds,
                req.user.id
            ]);

            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getPreferences(req, res) {
        try {
            const result = await db.query(notificationQueries.GET_USER_PREFERENCES, [req.user.id]);
            res.json(result.rows[0]?.notification_preferences || {});
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async updatePreferences(req, res) {
        const { preferences } = req.body;

        try {
            const result = await db.query(notificationQueries.UPDATE_PREFERENCES, [
                req.user.id,
                preferences
            ]);

            res.json(result.rows[0].notification_preferences);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new NotificationController();
