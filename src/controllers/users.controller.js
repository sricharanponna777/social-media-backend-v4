const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });
const db = require('../db/database');
const userQueries = require('../queries/users.queries');
const { hash, compare } = require('bcrypt');
const { createToken, createOtp, extractTokenFromHeader, verifyToken } = require('../utils/auth.utils');
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

class UserController {
    async register(req, res) {
        const { email, mobileNumber, countryCode, username, password, firstName, lastName, ...profile } = req.body;
        let transactionStarted = false;
        
        try {
            const fullMobileNumber = countryCode ? `+${countryCode} ${mobileNumber}` : mobileNumber;
            const existingEmail = await db.query(userQueries.GET_USER_BY_EMAIL, [email]);
            if (existingEmail.rows.length > 0) {
                return res.status(409).json({ error: 'Email already registered', field: 'email' });
            }

            const existingUsername = await db.query(userQueries.GET_USER_BY_USERNAME, [username]);
            if (existingUsername.rows.length > 0) {
                return res.status(409).json({ error: 'Username already taken', field: 'username' });
            }

            const existingMobile = await db.query(userQueries.GET_USER_BY_MOBILE_NUMBER, [fullMobileNumber]);
            if (existingMobile.rows.length > 0) {
                return res.status(409).json({ error: 'Phone number already registered', field: 'mobileNumber' });
            }

            await db.query('BEGIN');
            transactionStarted = true;

            // Hash password
            const passwordHash = await hash(password, 10);

            // Create user
            const result = await db.query(userQueries.CREATE_USER, [email, fullMobileNumber, username, passwordHash, firstName, lastName, profile.avatarUrl || null, profile.coverPhotoUrl || null, profile.bio || null, profile.location || null, profile.website || null, profile.isPrivate || false]);

            const user = result.rows[0];

            // Create OTP
            const otp = await createOtp(user);

            await db.query('COMMIT');
            transactionStarted = false;

            res.status(201).json({
                user,
                otp
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await db.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Register rollback error:', rollbackError);
                }
            }
            if (error.constraint === 'users_email_key') {
                return res.status(409).json({ error: 'Email already registered', field: 'email' });
            }
            if (error.constraint === 'users_username_key') {
                return res.status(409).json({ error: 'Username already taken', field: 'username' });
            }
            if (error.constraint === 'users_mobile_number_key') {
                return res.status(409).json({ error: 'Phone number already registered', field: 'mobileNumber' });
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
                return res.status(401).json({ error: 'Email not found' });
            }

            const user = result.rows[0];

            // Check if user is banned
            if (user.is_banned) {
                return res.status(403).json({ error: 'Account has been banned' });
            }

            const otpResult = (await db.query(userQueries.GET_OTP, [user.id]));
            const currentOtp = otpResult.rows[0]?.otp;

            // Verify OTP
            const isValid = String(otp) === String(currentOtp);
            if (!isValid) {
                return res.status(401).json({ error: 'Incorrect OTP' });
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
            console.error('Verify OTP error:', error);
            res.status(500).json({ error: 'Server error' });
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
                return res.status(401).json({ error: 'Email not found' });
            }

            const user = result.rows[0];

            // Check if user is banned
            if (user.is_banned) {
                return res.status(403).json({ error: 'Account has been banned' });
            }

            // Verify password
            const isValid = await compare(password, user.password_hash);
            if (!isValid) {
                return res.status(401).json({ error: 'Incorrect password' });
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
            console.error('Login error:', error);
            res.status(500).json({ error: 'Server error' });
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
