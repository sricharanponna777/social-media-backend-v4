const { body, validationResult } = require('express-validator');

// Validation chains
const userValidation = [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('username').isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/),
    body('mobileNumber').isMobilePhone()
];

const profileValidation = [
    body('firstName').optional().isString().trim(),
    body('lastName').optional().isString().trim(),
    body('bio').optional().isString().trim().isLength({ max: 500 }),
    body('location').optional().isString().trim(),
    body('website').optional().isURL(),
    body('isPrivate').optional().isBoolean()
];

const postValidation = [
    body('content').optional().isString().trim(),
    body('mediaUrls').optional().isArray(),
    body('mediaUrls.*').optional().isURL(),
    body('location').optional().isString().trim(),
    body('visibility').optional().isIn(['public', 'private', 'followers', 'close_friends'])
];

// Middleware to validate request
function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
}

// Message validation chains
const messageValidation = [
    body('content').isString().trim().notEmpty(),
    body('file').optional()
];

// Notification validation chains
const notificationValidation = {
    markRead: [
        body('notificationIds').isArray().notEmpty(),
        body('notificationIds.*').isUUID(4),
        validate
    ],
    delete: [
        body('notificationIds').isArray().notEmpty(),
        body('notificationIds.*').isUUID(4),
        validate
    ],
    updatePreferences: [
        body('preferences').isObject().notEmpty(),
        body('preferences.*.enabled').optional().isBoolean(),
        body('preferences.*.channels').optional().isArray(),
        body('preferences.*.channels.*').optional().isIn(['push', 'email', 'in_app']),
        validate
    ]
};

// Story validation chains
const storyValidation = {
    create: [
        body('content').optional().isString().trim(),
        body('mediaUrl').optional().isURL(),
        body('duration').optional().isInt({ min: 5, max: 60 }),
        body('type').optional().isIn(['image', 'video', 'poll']),
        body('audience').optional().isIn(['all', 'close_friends']),
        // Poll-specific fields
        body('poll').optional().isObject(),
        body('poll.question').optional().isString().trim(),
        body('poll.options').optional().isArray().isLength({ min: 2, max: 4 }),
        body('poll.options.*').optional().isString().trim(),
        body('poll.duration').optional().isInt({ min: 300, max: 86400 }), // 5 minutes to 24 hours
        validate
    ],
};

// Export validation middleware
module.exports = {
    validate,
    validateUser: [...userValidation, validate],
    validateProfile: [...profileValidation, validate],
    validatePost: [...postValidation, validate],
    validateMessage: {
        message: [...messageValidation, validate],
    },
    validateNotification: notificationValidation,
    validateStory: storyValidation
};
