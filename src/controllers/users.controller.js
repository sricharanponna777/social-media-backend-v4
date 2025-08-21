const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });
const db = require('../db/database');
const userQueries = require('../queries/users.queries');
const { hash, compare } = require('bcrypt');
const { createToken, createOtp, extractTokenFromHeader, verifyToken } = require('../utils/auth.utils');
const { AppError } = require('../utils/errors');
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

class UserController {
    async register(req, res) {
        const { email, mobileNumber, countryCode, username, password, firstName, lastName, ...profile } = req.body;
        
        try {
            db.query('BEGIN');
            // Hash password
            const passwordHash = await hash(password, 10);

            const fullMobileNumber = countryCode ? `+${countryCode} ${mobileNumber}` : mobileNumber;

            // Create user
            const result = await db.query(userQueries.CREATE_USER, [email, fullMobileNumber, username, passwordHash, firstName, lastName, profile.avatarUrl || null, profile.coverPhotoUrl || null, profile.bio || null, profile.location || null, profile.website || null, profile.isPrivate || false]);

            const user = result.rows[0];

            // Create OTP
            const otp = await createOtp(user);

            db.query('COMMIT');

            res.status(201).json({
                user,
                otp
            });
        } catch (error) {
            db.query('ROLLBACK');
            if (error.constraint === 'users_email_key') {
                return res.status(409).json({ error: 'Email already registered' });
            }
            if (error.constraint === 'users_username_key') {
                return res.status(409).json({ error: 'Username already taken' });
            }
            console.log('Register error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }

    async verifyOtp(req, res) {
        const { otp, email } = req.body;
        
        try {
            const result = await db.query(userQueries.GET_USER_BY_EMAIL, [email]);
            
            if (result.rows.length === 0) {
                throw new AppError('Invalid credentials: Email not found', 401);
            }

            const user = result.rows[0];

            // Check if user is banned
            if (user.is_banned) {
                throw new AppError('Account has been banned', 403);
            }

            const otpResult = (await db.query(userQueries.GET_OTP, [user.id]));
            user.otp = otpResult.rows[0].otp;

            console.log('user: ', JSON.stringify(user));

            // Verify OTP
            const isValid = await otp == user.otp;
            if (!isValid) {
                throw new AppError('Invalid credentials: Incorrect OTP', 401);        
            }
            
            // Update user
            await db.query(userQueries.USE_OTP, [user.id, otp]);
            await db.query(userQueries.VERIFY_USER, [user.id]);

            // Create token
            const token = createToken(user);

            res.status(200).json({
                token
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(`Server error: ${error.message}`, 500);
        }
    }

    async getProfile(req, res) {
        try {
            const result = await db.query(userQueries.GET_USER_BY_ID, [req.params.id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }

    async updateProfile(req, res) {
        const { firstName, lastName, avatarUrl, coverPhotoUrl, bio, location, website, isPrivate } = req.body;
        
        try {
            const result = await db.query(userQueries.UPDATE_USER, [
                req.user.id,
                firstName,
                lastName,
                avatarUrl,
                coverPhotoUrl,
                bio,
                location,
                website,
                isPrivate
            ]);

            res.json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }

    async searchUsers(req, res) {
        const { query } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        try {
            const result = await db.query(userQueries.SEARCH_USERS, [
                `%${query}%`,
                limit,
                offset
            ]);

            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }

    async deleteAccount(req, res) {
        try {
            await db.query(userQueries.DELETE_USER, [req.user.id]);
            res.status(204).send();
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }

    async login(req, res) {
        const { email, password } = req.body;
        
        try {
            // Get user by email
            const result = await db.query(userQueries.GET_USER_BY_EMAIL, [email]);
            
            if (result.rows.length === 0) {
                throw new AppError('Invalid credentials: Email not found', 401);
            }

            const user = result.rows[0];

            // Check if user is banned
            if (user.is_banned) {
                throw new AppError('Account has been banned', 403);
            }

            // Verify password
            const isValid = await compare(password, user.password_hash);
            if (!isValid) {
                throw new AppError('Invalid credentials: Incorrect password or email', 401);        
            }

            // Create token
            const token = createToken(user);

            // Return user and token
            delete user.password_hash;
            res.json({
                user,
                token
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError('Server error', 500);
        }
    }

    async verifyTokenRoute(req, res) {
        try {
            const { token } = req.body;
            const decoded = verifyToken(token);
            res.json({
                message: 'Token is valid',
                user: decoded,
                verified: true
            });
        } catch (error) {
            res.status(200).json({ 
                error: 'Invalid token',
                verified: false
            });
        }
    }
}

module.exports = new UserController();
