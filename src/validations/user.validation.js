const { body } = require('express-validator');

const userValidation = {
    register: [
        body('email')
            .isEmail()
            .normalizeEmail()
            .trim()
            .withMessage('Invalid email address'),
        body('mobileNumber')
            .matches(/[\d\s\-()]{6,20}/)
            .withMessage('Invalid mobile number'),
        body('countryCode')
            .matches(/\d{1,4}/),
        body('username')
            .isLength({ min: 3, max: 30 })
            .trim()
            .matches(/^[a-zA-Z0-9_]+$/)
            .withMessage('Username must be between 3-30 characters and can only contain letters, numbers, and underscores'),
        body('password')
            .isLength({ min: 8 })
            .matches(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/)
            .withMessage('Password must be at least 8 characters and contain at least one letter and one number'),
        body('firstName')
            .optional()
            .isLength({ min: 2, max: 50 })
            .trim()
            .withMessage('First name must be between 2-50 characters'),
        body('lastName')
            .optional()
            .isLength({ min: 2, max: 50 })
            .trim()
            .withMessage('Last name must be between 2-50 characters'),
        body('avatarUrl')
            .optional()
            .isURL()
            .withMessage('Invalid avatar URL'),
        body('coverPhotoUrl')
            .optional()
            .isURL()
            .withMessage('Invalid cover photo URL'),
        body('bio')
            .optional()
            .isLength({ max: 500 })
            .withMessage('Bio must not exceed 500 characters'),
        body('location')
            .optional()
            .isLength({ max: 100 })
            .withMessage('Location must not exceed 100 characters'),
        body('website')
            .optional()
            .isURL()
            .withMessage('Invalid website URL'),
        body('isPrivate')
            .optional()
            .isBoolean()
            .withMessage('isPrivate must be a boolean')
    ],

    login: [
        body('email')
            .isEmail()
            .normalizeEmail()
            .withMessage('Invalid email address'),
        body('password')
            .exists()
            .withMessage('Password is required')
    ],

    updateProfile: [
        body('firstName')
            .optional()
            .isLength({ min: 2, max: 50 })
            .trim()
            .withMessage('First name must be between 2-50 characters'),
        body('lastName')
            .optional()
            .isLength({ min: 2, max: 50 })
            .trim()
            .withMessage('Last name must be between 2-50 characters'),
        body('avatarUrl')
            .optional()
            .isURL()
            .withMessage('Invalid avatar URL'),
        body('coverPhotoUrl')
            .optional()
            .isURL()
            .withMessage('Invalid cover photo URL'),
        body('bio')
            .optional()
            .isLength({ max: 500 })
            .withMessage('Bio must not exceed 500 characters'),
        body('location')
            .optional()
            .isLength({ max: 100 })
            .withMessage('Location must not exceed 100 characters'),
        body('website')
            .optional()
            .isURL()
            .withMessage('Invalid website URL'),
        body('isPrivate')
            .optional()
            .isBoolean()
            .withMessage('isPrivate must be a boolean')
    ]
};

module.exports = {
    userValidation
};
