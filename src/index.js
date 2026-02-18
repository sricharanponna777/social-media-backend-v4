require('dotenv').config({ path: './src/config/.env' });
const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const os = require('os');
const SocketService = require('./services/socket.service');
const path = require('path');

// Import routes
const userRoutes = require('./routes/users.routes');
const postRoutes = require('./routes/posts.routes');
const messageRoutes = require('./routes/messages.routes');
const notificationRoutes = require('./routes/notifications.routes');
const storyRoutes = require('./routes/stories.routes');
const reelsRoutes = require('./routes/reels.routes');
const affiliateRoutes = require('./routes/affiliate.routes');
const interestsRoutes = require('./routes/interests.routes');
const votesRoutes = require('./routes/votes.routes');
const reactionsRoutes = require('./routes/reactions.routes');
const commentsRoutes = require('./routes/comments.routes');
const friendsRoutes = require('./routes/friends.routes');
const uploadsRoutes = require('./routes/uploads.routes');

// Create Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
global.socketService = new SocketService(server);

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));
app.use(helmet());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

morgan.token('body', (req) => JSON.stringify(req.body));

app.use(morgan(':method :url :status - :response-time ms - body: :body'));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limiting middleware
const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
    windowMs: 15 * 1000, // 15 seconds
    max: 1000000 // limit each IP to 1000000 requests per windowMs
});
app.use('/api/', apiLimiter);
app.get('/api/health', (req, res) => {
    res.status(200).json({ message: 'API is healthy' });
});

// Routes
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/reels', reelsRoutes);
app.use('/api/affiliate', affiliateRoutes);
app.use('/api/interests', interestsRoutes);
app.use('/api/votes', votesRoutes);
// Legacy alias route.
app.use('/api/reactions', reactionsRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/uploads', uploadsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);

    if (typeof err.statusCode === 'number') {
        return res.status(err.statusCode).json({
            error: err.message || 'Request failed',
            ...(err.details && { details: err.details })
        });
    }
    
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation Error',
            details: err.details
        });
    }

    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Unauthorized',
            message: err.message
        });
    }

    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const getLanUrls = () => {
    const nets = os.networkInterfaces();
    const urls = [];

    for (const entries of Object.values(nets)) {
        if (!entries) continue;
        for (const entry of entries) {
            if (entry.family === 'IPv4' && !entry.internal) {
                urls.push(`http://${entry.address}:${PORT}`);
            }
        }
    }

    return urls;
};

server.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
    console.log(`Local URL: http://localhost:${PORT}`);
    const lanUrls = getLanUrls();
    if (lanUrls.length > 0) {
        console.log(`LAN URL(s): ${lanUrls.join(', ')}`);
    }
    console.log(`Environment: ${process.env.NODE_ENV}`);
});
