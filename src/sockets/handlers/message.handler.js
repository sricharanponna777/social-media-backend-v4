const db = require('../../config/database.config');
const messageQueries = require('../../queries/messages.queries');

function messageHandler(io, socket) {
    // Send message
    socket.on('send_message', async (data) => {
        try {
            const { conversationId, content, messageType, mediaUrl } = data;

            // Save message to database
            const result = await db.query(messageQueries.CREATE_MESSAGE, [
                conversationId,
                socket.userId,
                content,
                messageType,
                mediaUrl
            ]);

            const message = result.rows[0];

            // Emit to all participants in the conversation
            const participantsResult = await db.query(messageQueries.GET_CONVERSATION_PARTICIPANTS, [
                conversationId
            ]);

            participantsResult.rows.forEach(participant => {
                io.to(`user:${participant.user_id}`).emit('new_message', message);
            });

        } catch (error) {
            console.error('Message error:', error);
            socket.emit('message_error', { error: 'Failed to send message' });
        }
    });

    // Mark messages as read
    socket.on('mark_read', async (data) => {
        try {
            const { conversationId } = data;

            await db.query(messageQueries.MARK_MESSAGES_READ, [
                conversationId,
                socket.userId
            ]);

            // Emit read status to conversation participants
            socket.to(`conversation:${conversationId}`).emit('messages_read', {
                conversationId,
                userId: socket.userId
            });

        } catch (error) {
            console.error('Mark read error:', error);
            socket.emit('mark_read_error', { error: 'Failed to mark messages as read' });
        }
    });

    // Join conversation room
    socket.on('join_conversation', (conversationId) => {
        socket.join(`conversation:${conversationId}`);
    });

    // Leave conversation room
    socket.on('leave_conversation', (conversationId) => {
        socket.leave(`conversation:${conversationId}`);
    });
}

module.exports = messageHandler;
