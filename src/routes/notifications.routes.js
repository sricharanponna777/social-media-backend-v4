const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notifications.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateNotification } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// Get user's notifications
router.get('/', NotificationController.getNotifications);

// Get unread notifications count
router.get('/unread', NotificationController.getUnreadCount);

// Mark notifications as read
router.post('/read',
    validateNotification.markRead,
    NotificationController.markAsRead
);

// Delete notifications
router.delete('/',
    validateNotification.delete,
    NotificationController.deleteNotifications
);

// Get notification preferences
router.get('/preferences', NotificationController.getPreferences);

// Update notification preferences
router.put('/preferences',
    validateNotification.updatePreferences,
    NotificationController.updatePreferences
);

module.exports = router;
