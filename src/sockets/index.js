const messageHandler = require('./handlers/message.handler');

function initializeHandlers(io) {
    // Middleware to attach user data to socket
    io.use((socket, next) => {
        const userId = socket.user.id;
        socket.userId = userId;
        next();
    });

    // Handle connection
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.userId}`);

        // Join user's personal room for private messages
        socket.join(`user:${socket.userId}`);

        // Initialize handlers
        messageHandler(io, socket);

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.userId}`);
        });
    });
}

module.exports = initializeHandlers;
