const { validationResult } = require('express-validator');

// Validation middleware factory
const validate = (validations) => {
    return async (req, res, next) => {
        // Run all validations
        if (Array.isArray(validations)) {
            await Promise.all(validations.map(validation => validation.run(req)));
        } else if (validations) {
            await Promise.all(validations.map(validation => validation.run(req)));
        }

        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            console.log('Validation errors:', errors.array());
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }
        next();
    };
};

module.exports = { validate };
