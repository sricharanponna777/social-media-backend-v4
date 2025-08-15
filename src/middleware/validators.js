const { body, param } = require('express-validator');
const validate = require('./validate');

const messageValidation = {
    conversation: [
        body('title')
            .optional()
            .isString()
            .trim()
            .isLength({ max: 100 }),
        body('participants')
            .isArray()
            .withMessage('Participants must be an array')
            .notEmpty()
            .withMessage('Must include at least one participant'),
        body('participants.*')
            .isUUID()
            .withMessage('Invalid participant ID'),
        body('type')
            .optional()
            .isIn(['private', 'group'])
            .withMessage('Type must be either private or group'),
        validate
    ],

    message: [
        body('content')
            .optional()
            .isString()
            .trim()
            .notEmpty()
            .withMessage('Message content cannot be empty'),
        body('messageType')
            .optional()
            .isIn(['text', 'image', 'video', 'file', 'audio'])
            .withMessage('Invalid message type'),
        validate
    ]
};

const storyValidation = {
    create: [
        body('mediaType')
            .isIn(['image', 'video', 'text', 'poll'])
            .withMessage('Invalid media type'),
        body('caption')
            .optional()
            .isString()
            .trim()
            .isLength({ max: 500 }),
        body('location')
            .optional()
            .isString()
            .trim()
            .isLength({ max: 100 }),
        body('duration')
            .optional()
            .isInt({ min: 3, max: 15 })
            .withMessage('Duration must be between 3 and 15 seconds'),
        body('pollType')
            .optional()
            .isIn(['yes_no', 'multiple_choice', 'slider', null])
            .withMessage('Invalid poll type'),
        validate
    ],

    view: [
        body('viewDuration')
            .isInt({ min: 0 })
            .withMessage('View duration must be a positive number'),
        body('completed')
            .optional()
            .isBoolean()
            .withMessage('Completed must be a boolean'),
        validate
    ]
};

const notificationValidation = {
    markRead: [
        body('notificationIds')
            .isArray()
            .withMessage('Notification IDs must be an array')
            .notEmpty()
            .withMessage('Must include at least one notification ID'),
        body('notificationIds.*')
            .isUUID()
            .withMessage('Invalid notification ID'),
        validate
    ],

    delete: [
        body('notificationIds')
            .isArray()
            .withMessage('Notification IDs must be an array')
            .notEmpty()
            .withMessage('Must include at least one notification ID'),
        body('notificationIds.*')
            .isUUID()
            .withMessage('Invalid notification ID'),
        validate
    ],

    updatePreferences: [
        body('preferences')
            .isObject()
            .withMessage('Preferences must be an object'),
        body('preferences.email')
            .optional()
            .isBoolean(),
        body('preferences.push')
            .optional()
            .isBoolean(),
        body('preferences.types.*')
            .optional()
            .isBoolean(),
        validate
    ]
};

module.exports = {
    validateMessage: messageValidation,
    validateStory: storyValidation,
    validateNotification: notificationValidation
};
