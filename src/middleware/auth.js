const { verifyToken, extractTokenFromHeader } = require('../utils/auth.utils');
const { AppError } = require('../utils/errors');
const db = require('../db/database');

const auth = async (req, res, next) => {
    try {
        const token = extractTokenFromHeader(req);
        if (!token) {
            throw new AppError('No token provided', 401);
        }

        const decoded = verifyToken(token);
        
        // Get user from database
        const result = await db.query(
            'SELECT id, email, username, is_banned FROM users WHERE id = $1 AND deleted_at IS NULL',
            [decoded.id]
        );

        if (!result.rows[0]) {
            throw new AppError('User not found', 401);
        }

        if (result.rows[0].is_banned) {
            throw new AppError('Account has been banned', 403);
        }

        // Update last active timestamp
        await pool.query(
            'UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1',
            [decoded.id]
        );

        req.user = result.rows[0];
        next();
    } catch (error) {
        next(error);
    }
};

const optionalAuth = async (req, res, next) => {
    try {
        const token = extractTokenFromHeader(req);
        if (!token) {
            return next();
        }

        const decoded = verifyToken(token);
        
        const result = await pool.query(
            'SELECT id, email, username FROM users WHERE id = $1 AND deleted_at IS NULL',
            [decoded.id]
        );

        if (result.rows[0]) {
            req.user = result.rows[0];
        }
        
        next();
    } catch (error) {
        // Invalid token, but we don't care for optional auth
        next();
    }
};

module.exports = {
    auth,
    optionalAuth
};
