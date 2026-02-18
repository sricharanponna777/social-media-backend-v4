const db = require('../db/database');
const messageQueries = require('../queries/messages.queries');
const notificationService = require('../services/notification.service');

class MessageController {
    static async createConversation(req, res) {
        const { title, participants, type = 'private' } = req.body;
        const creatorId = req.user.id;

        if (!['private', 'group'].includes(type)) {
            return res.status(400).json({ error: 'Invalid conversation type' });
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const cleaned = [...new Set(
            (participants || [])
                .map(id => String(id).trim())
                .filter(id => uuidRegex.test(id) && id !== creatorId)
        )];

        if (type === 'private' && cleaned.length !== 1) {
            return res.status(400).json({ error: 'Private conversations require exactly one participant' });
        }

        if (type === 'group' && cleaned.length === 0) {
            return res.status(400).json({ error: 'Group conversations require at least one participant' });
        }

        try {
            const { rows: existingRows } = await db.query(
                'SELECT id FROM users WHERE id = ANY($1::uuid[])',
                [cleaned]
            );
            const existingIds = new Set(existingRows.map((r) => r.id));
            const missing = cleaned.filter((id) => !existingIds.has(id));

            if (missing.length) {
                return res.status(400).json({
                    error: 'Some participant IDs do not exist',
                    missing_user_ids: missing
                });
            }

            if (type === 'private') {
                const existingConversation = await db.query(
                    messageQueries.GET_EXISTING_PRIVATE_CONVERSATION,
                    [creatorId, cleaned[0]]
                );
                if (existingConversation.rows[0]) {
                    return res.status(200).json(existingConversation.rows[0]);
                }
            }

            const conversation = await db.transaction(async (client) => {
                const { rows } = await client.query(
                    messageQueries.CREATE_CONVERSATION,
                    [creatorId, title, type]
                );
                const createdConversation = rows[0];

                await client.query(
                    messageQueries.ADD_PARTICIPANT,
                    [createdConversation.id, creatorId, 'owner']
                );

                if (cleaned.length) {
                    await client.query(
                        `
                        INSERT INTO conversation_participants (conversation_id, user_id, role)
                        SELECT $1::uuid, user_id, 'member'
                        FROM unnest($2::uuid[]) AS user_id
                        ON CONFLICT (conversation_id, user_id) DO NOTHING;
                        `,
                        [createdConversation.id, cleaned]
                    );
                }

                return createdConversation;
            });

            await Promise.all(
                cleaned.map(async (userId) => {
                    try {
                        await notificationService.createNotification({
                            user_id: userId,
                            actor_id: creatorId,
                            type: 'message',
                            target_type: 'conversation',
                            target_id: conversation.id,
                            message: type === 'private'
                                ? 'started a conversation with you'
                                : 'added you to a group'
                        });
                    } catch (e) {
                        console.error('Failed to create conversation notification:', e.message);
                    }
                })
            );

            return res.status(201).json(conversation);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: error.message });
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
            const participantCheck = await db.query(messageQueries.CHECK_PARTICIPANT, [
                conversationId,
                req.user.id
            ]);

            if (participantCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Not a participant in this conversation' });
            }

            // Load messages with sender details
            const result = await db.query(messageQueries.GET_MESSAGES, [
                conversationId,
                limit,
                offset
            ]);

            // Get conversation meta
            const convoRes = await db.query(messageQueries.GET_CONVERSATION, [conversationId]);
            const conversation = convoRes.rows[0] || null;

            let otherUser = null;
            if (conversation && conversation.type === 'private') {
                const otherRes = await db.query(messageQueries.GET_OTHER_PARTICIPANT, [conversationId, req.user.id]);
                otherUser = otherRes.rows[0] || null;
            }

            // Mark messages as read
            await db.query(messageQueries.MARK_MESSAGES_READ, [
                conversationId,
                req.user.id
            ]);

            // Include sender details only for messages not from the logged-in user
            const messages = result.rows.map((m) => {
                if (m.sender_id === req.user.id) {
                    const { sender_username, sender_full_name, ...rest } = m;
                    return rest;
                }
                return m;
            });

            res.json({
                conversation: conversation ? {
                    id: conversation.id,
                    type: conversation.type,
                    title: conversation.title,
                    other_user: otherUser
                } : null,
                messages
            });
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

                await client.query(messageQueries.UPDATE_CONVERSATION_ACTIVITY, [
                    conversationId,
                    message.created_at
                ]);

                // Enrich with sender details for clients (esp. group chats)
                try {
                    const senderRes = await client.query('SELECT username, full_name FROM users WHERE id = $1', [req.user.id]);
                    const prevRes = await client.query(
                        `SELECT sender_id FROM messages
                         WHERE conversation_id = $1 AND id <> $2 AND deleted_at IS NULL
                         ORDER BY created_at DESC, id DESC LIMIT 1`,
                        [conversationId, message.id]
                    );
                    const prevSenderId = prevRes.rows[0]?.sender_id || null;
                    const sameAsPrev = prevSenderId && prevSenderId === req.user.id;
                    if (senderRes.rows[0] && !sameAsPrev) {
                        message.sender_username = senderRes.rows[0].username;
                        message.sender_full_name = senderRes.rows[0].full_name;
                    }
                } catch (e) {
                    // non-fatal
                    console.error('Failed to load sender details for http message:', e);
                }

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

            // Notify other participants (notifications + realtime)
            await Promise.all(
                result.participants.map(async (participant) => {
                    try {
                        await notificationService.createNotification({
                            user_id: participant.user_id,
                            actor_id: req.user.id,
                            type: 'message',
                            target_type: 'conversation',
                            target_id: conversationId,
                            message: 'sent you a message'
                        });
                    } catch (e) {
                        console.error('Failed to create message notification:', e.message);
                    }
                    try {
                        if (global.socketService) {
                            global.socketService.emitToUser(participant.user_id, 'new_message', result.message);
                        }
                    } catch (e) {
                        console.error('Socket emit error (new_message):', e);
                    }
                })
            );

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
