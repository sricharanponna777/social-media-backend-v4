const express = require('express');
const router = express.Router();
const MessageController = require('../controllers/messages.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateMessage } = require('../middleware/validation.middleware');
const fileService = require('../services/file.service');

// All routes require authentication
router.use(authenticate);

// Create new conversation
router.post('/conversations', validateMessage.conversation, MessageController.createConversation);

// Get user's conversations
router.get('/conversations', MessageController.getConversations);

// Get messages from a conversation
router.get('/conversations/:conversationId', MessageController.getMessages);

// Send a message with optional file attachment
router.post('/conversations/:conversationId',
    fileService.getUploadMiddleware('file', 1),
    validateMessage.message,
    MessageController.sendMessage
);

// Get unread message count
router.get('/unread', MessageController.getUnreadCount);

// Delete a message
router.delete('/:messageId', MessageController.deleteMessage);

module.exports = router;
