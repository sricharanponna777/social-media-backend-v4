const jwt = require('jsonwebtoken');
const db = require('../db/database');
const userQueries = require('../queries/users.queries');
const { AppError } = require('./errors');
const nodemailer = require('nodemailer');
const path = require('path');
const axios = require('axios');

require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Email transport (optional fallback)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    from: process.env.SMTP_FROM
});

// OTP generator
function generate(n, chunks = 0, separator = ' ') {
    var add = 1, max = 12 - add;

    var out;
    if (n > max) {
        out = generate(max) + generate(n - max);
    } else {
        max = Math.pow(10, n + add);
        var min = max / 10;
        var number = Math.floor(Math.random() * (max - min + 1)) + min;
        out = ("" + number).substring(add);
    }

    if (chunks > 0 && n > chunks) {
        const instead = [];
        for (let i = 0; i < out.length; i++) {
            if (i > 0 && i % chunks === 0) instead.push(separator);
            instead.push(out[i]);
        }
        return instead.join('');
    }

    return out;
}

const generateRandomOtp = () => {
    return generate(6, 0);
};

// ✅ Send OTP via TextMeBot
const sendOtp = async (user, otp) => {
    const phone = user.mobile_number; // Must be in E.164 format e.g., +447920123456
    const apiKey = process.env.TEXTMEBOT_API_KEY || 'gz6kj5DdgBky';
    const message = `Your OTP is ${otp}`;
    const url = `http://api.textmebot.com/send.php?recipient=${encodeURIComponent(phone)}&apikey=${apiKey}&text=${encodeURIComponent(message)}`;

    try {
        const response = await axios.get(url);
        console.log('TextMeBot OTP sent:', response.data);
    } catch (error) {
        console.error('TextMeBot OTP send failed:', error.message);
        throw new Error('Failed to send OTP via TextMeBot');
    }

    // Optional: Email as fallback
    if (user.email) {
        await transporter.sendMail({
            from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM_ADDRESS}>`,
            to: user.email,
            subject: 'Your OTP Code',
            text: message
        });
    }
};

// Create and send OTP
const createOtp = async (user) => {
    const otp = generateRandomOtp();
    await db.query(userQueries.UPDATE_LAST_ACTIVE, [user.id]);
    await db.query(userQueries.CREATE_OTP, [user.id, otp]);
    await sendOtp(user, otp);
    return otp;
};

// JWT
const createToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            username: user.username
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
};

const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        throw new AppError('Invalid token', 401);
    }
};

const extractTokenFromHeader = (req) => {
    const authHeader = req.headers.Authorization;
    if (!authHeader) {
        return null;
    }

    const [bearer, token] = authHeader.split(' ');
    if (bearer !== 'Bearer' || !token) {
        return null;
    }

    return token;
};

module.exports = {
    createToken,
    verifyToken,
    extractTokenFromHeader,
    createOtp
};
