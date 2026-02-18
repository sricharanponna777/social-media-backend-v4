const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const messageQueries = require('../queries/messages.queries');
const notificationService = require('./notification.service');

class SocketService {
    constructor(server) {
        this.io = socketIo(server, {
            cors: {
                origin: process.env.FRONTEND_URL,
                methods: ['GET', 'POST'],
                credentials: true
            }
        });
        
        this.connectedUsers = new Map();
        this.initialize();
    }

    initialize() {
        this.io.use(this.authenticateSocket.bind(this));
        this.io.on('connection', this.handleConnection.bind(this));
    }

    async authenticateSocket(socket, next) {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentication required'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;

            const { rows: user } = await db.query('SELECT * FROM users WHERE id = $1', [decoded.id]);

            console.log(JSON.stringify(user));
            
            // Update user's online status
            await db.query(
                'UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
                [decoded.id]
            );

            next();
        } catch (error) {
            next(new Error('Authentication failed'));
        }
    }

    handleConnection(socket) {
        const userId = socket.user.id;
        console.log(`User connected: ${userId}`);

        // Store socket connection
        this.connectedUsers.set(userId, socket);

        // Join user's personal room
        socket.join(`user:${userId}`);

        // Handle messages
        socket.on('send_message', (data) => this.handleMessage(socket, data));
        socket.on('join_conversation', (data) => this.joinConversation(socket, data));
        socket.on('typing_start', (data) => this.handleTyping(socket, data, true));
        socket.on('typing_stop', (data) => this.handleTyping(socket, data, false));

        // Handle notifications
        socket.on('read_notifications', (data) => this.markNotificationsRead(socket, data));

        // Handle disconnection
        socket.on('disconnect', () => this.handleDisconnection(socket));
    }

    async handleMessage(socket, { conversationId, content, type = 'text', mediaUrl = null }) {
        const validTypes = new Set(['text', 'image', 'video', 'file', 'audio']);
        const messageType = validTypes.has(type) ? type : 'text';
        const normalizedContent = typeof content === 'string' ? content.trim() : '';

        if (!conversationId || (!normalizedContent && !mediaUrl)) {
            socket.emit('error', { message: 'Invalid message payload' });
            return;
        }

        try {
            const result = await db.transaction(async (client) => {
                const participantCheck = await client.query(messageQueries.CHECK_PARTICIPANT, [
                    conversationId,
                    socket.user.id
                ]);
                if (participantCheck.rows.length === 0) {
                    throw new Error('NOT_PARTICIPANT');
                }

                const messageInsert = await client.query(
                    `
                    INSERT INTO messages (conversation_id, sender_id, message, message_type, media_url)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id, conversation_id, sender_id, message, message_type, media_url, created_at
                    `,
                    [conversationId, socket.user.id, normalizedContent || null, messageType, mediaUrl]
                );
                const message = messageInsert.rows[0];

                await client.query(messageQueries.UPDATE_CONVERSATION_ACTIVITY, [
                    conversationId,
                    message.created_at
                ]);

                try {
                    const senderRes = await client.query('SELECT username, full_name FROM users WHERE id = $1', [socket.user.id]);
                    const prevRes = await client.query(
                        `SELECT sender_id FROM messages
                         WHERE conversation_id = $1 AND id <> $2 AND deleted_at IS NULL
                         ORDER BY created_at DESC, id DESC LIMIT 1`,
                        [conversationId, message.id]
                    );
                    const prevSenderId = prevRes.rows[0]?.sender_id || null;
                    const sameAsPrev = prevSenderId && prevSenderId === socket.user.id;
                    if (senderRes.rows[0] && !sameAsPrev) {
                        message.sender_username = senderRes.rows[0].username;
                        message.sender_full_name = senderRes.rows[0].full_name;
                    }
                } catch (e) {
                    console.error('Failed to load sender details for socket message:', e);
                }

                const participants = await client.query(
                    `
                    SELECT user_id
                    FROM conversation_participants
                    WHERE conversation_id = $1 AND deleted_at IS NULL
                    `,
                    [conversationId]
                );

                return {
                    message,
                    participants: participants.rows
                };
            });

            await Promise.all(
                result.participants.map(async ({ user_id }) => {
                    this.io.to(`user:${user_id}`).emit('new_message', result.message);

                    if (user_id === socket.user.id) {
                        return;
                    }

                    const participantSocket = this.connectedUsers.get(user_id);
                    const isActivelyViewingConversation = participantSocket?.rooms?.has(`conversation:${conversationId}`);

                    if (isActivelyViewingConversation) {
                        try {
                            await db.query(
                                `
                                UPDATE conversation_participants
                                SET last_read_at = $3
                                WHERE conversation_id = $1
                                  AND user_id = $2
                                  AND deleted_at IS NULL
                                `,
                                [conversationId, user_id, result.message.created_at]
                            );
                        } catch (e) {
                            console.error('Failed to mark socket-received message as read:', e.message);
                        }
                        return;
                    }

                    try {
                        await notificationService.createNotification({
                            user_id,
                            actor_id: socket.user.id,
                            type: 'message',
                            target_type: 'conversation',
                            target_id: conversationId,
                            message: 'sent you a message'
                        });
                    } catch (e) {
                        console.error('Failed to create socket message notification:', e.message);
                    }
                })
            );

        } catch (error) {
            if (error.message === 'NOT_PARTICIPANT') {
                socket.emit('error', { message: 'Not authorized to send messages in this conversation' });
                return;
            }
            console.error('Message handling error:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    }

    async joinConversation(socket, { conversationId }) {
        try {
            // Verify user is participant
            const result = await db.query(`
                SELECT 1 FROM conversation_participants
                WHERE conversation_id = $1 AND user_id = $2 AND deleted_at IS NULL
            `, [conversationId, socket.user.id]);

            if (result.rows.length > 0) {
                socket.join(`conversation:${conversationId}`);
                await db.query(
                    `
                    UPDATE conversation_participants
                    SET last_read_at = CURRENT_TIMESTAMP
                    WHERE conversation_id = $1 AND user_id = $2 AND deleted_at IS NULL
                    `,
                    [conversationId, socket.user.id]
                );
                socket.emit('joined_conversation', { conversationId });
            } else {
                socket.emit('error', { message: 'Not authorized to join conversation' });
            }
        } catch (error) {
            console.error('Join conversation error:', error);
            socket.emit('error', { message: 'Failed to join conversation' });
        }
    }

    handleTyping(socket, { conversationId }, isTyping) {
        socket.to(`conversation:${conversationId}`).emit('typing_status', {
            userId: socket.user.id,
            conversationId,
            isTyping
        });
    }

    async markNotificationsRead(socket, { notificationIds }) {
        try {
            await db.query(`
                UPDATE notifications
                SET is_read = true, read_at = CURRENT_TIMESTAMP
                WHERE id = ANY($1) AND user_id = $2
            `, [notificationIds, socket.user.id]);

            socket.emit('notifications_marked_read', { notificationIds });
        } catch (error) {
            console.error('Mark notifications read error:', error);
            socket.emit('error', { message: 'Failed to mark notifications as read' });
        }
    }

    async handleDisconnection(socket) {
        const userId = socket.user.id;
        console.log(`User disconnected: ${userId}`);

        // Update last active timestamp
        try {
            await db.query(
                'UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1',
                [userId]
            );
        } catch (error) {
            console.error('Error updating last active timestamp:', error);
        }

        // Remove from connected users
        this.connectedUsers.delete(userId);
    }

    // Utility methods for other parts of the application
    isUserOnline(userId) {
        return this.connectedUsers.has(userId);
    }

    emitToUser(userId, event, data) {
        this.io.to(`user:${userId}`).emit(event, data);
    }

    emitToConversation(conversationId, event, data) {
        this.io.to(`conversation:${conversationId}`).emit(event, data);
    }
}

module.exports = SocketService;
