const db = require('../db/database');
const messageQueries = require('../queries/messages.queries');
const notificationService = require('../services/notification.service');

class MessageController {
    static async createConversation(req, res) {
        const { title, participants, type = 'private' } = req.body;

        try {
            const result = await db.transaction(async (client) => {
                // Create conversation
                const conversationResult = await client.query(messageQueries.CREATE_CONVERSATION, [
                    req.user.id,
                    title,
                    type
                ]);
                const conversation = conversationResult.rows[0];

                // Add creator as participant
                await client.query(messageQueries.ADD_PARTICIPANT, [
                    conversation.id,
                    req.user.id,
                    'owner'
                ]);

                // Add other participants
                await Promise.all(participants.map(userId =>
                    client.query(messageQueries.ADD_PARTICIPANT, [
                        conversation.id,
                        userId,
                        'member'
                    ])
                ));

                return conversation;
            });

            // Notify participants
            participants.forEach(userId => {
                notificationService.createNotification({
                    user_id: userId,
                    actor_id: req.user.id,
                    type: 'new_conversation',
                    target_type: 'conversation',
                    target_id: result.id,
                    message: type === 'private' ? 'started a conversation with you' : 'added you to a group'
                });
            });

            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async getConversations(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        try {
            const result = await db.query(messageQueries.GET_CONVERSATIONS, [
                req.user.id,
                limit,
                offset
            ]);

            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async getMessages(req, res) {
        const { conversationId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        try {
            const result = await db.query(messageQueries.GET_MESSAGES, [
                conversationId,
                limit,
                offset
            ]);

            // Mark messages as read
            await db.query(messageQueries.MARK_MESSAGES_READ, [
                conversationId,
                req.user.id
            ]);

            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async getUnreadCount(req, res) {
        try {
            const result = await db.query(messageQueries.GET_UNREAD_COUNT, [req.user.id]);
            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async deleteMessage(req, res) {
        const { messageId } = req.params;

        try {
            const result = await db.query(messageQueries.DELETE_MESSAGE, [
                messageId,
                req.user.id
            ]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Message not found or unauthorized' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async sendMessage(req, res) {
        const { conversationId } = req.params;
        const { content } = req.body;
        const file = req.file;

        try {
            const result = await db.transaction(async (client) => {
                // First verify user is part of conversation
                const participantCheck = await client.query(messageQueries.CHECK_PARTICIPANT, [
                    conversationId,
                    req.user.id
                ]);

                if (participantCheck.rows.length === 0) {
                    throw new Error('Not a participant in this conversation');
                }

                // Create message
                const messageResult = await client.query(messageQueries.CREATE_MESSAGE, [
                    conversationId,
                    req.user.id,
                    content,
                    file ? file.path : null
                ]);

                const message = messageResult.rows[0];

                // Get other participants to notify them
                const participants = await client.query(messageQueries.GET_CONVERSATION_PARTICIPANTS, [
                    conversationId,
                    req.user.id // exclude sender
                ]);

                return {
                    message,
                    participants: participants.rows
                };
            });

            // Notify other participants
            result.participants.forEach(participant => {
                notificationService.createNotification({
                    user_id: participant.user_id,
                    actor_id: req.user.id,
                    type: 'new_message',
                    target_type: 'message',
                    target_id: result.message.id,
                    message: 'sent you a message'
                });
            });

            res.status(201).json(result.message);
        } catch (error) {
            if (error.message === 'Not a participant in this conversation') {
                res.status(403).json({ error: error.message });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    }
}

module.exports = MessageController;
