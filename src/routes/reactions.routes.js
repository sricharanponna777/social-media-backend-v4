const express = require('express');
const router = express.Router();
const ReactionsController = require('../controllers/reactions.controller');
const { authenticate } = require('../middleware/auth.middleware');

// All routes require authentication
router.use(authenticate);

// Add a reaction to content
router.post('/', ReactionsController.addReaction);

// Remove a reaction from content
router.delete('/:content_type/:content_id', ReactionsController.removeReaction);

// Get reactions for content
router.get('/:content_type/:content_id', ReactionsController.getReactions);

module.exports = router;