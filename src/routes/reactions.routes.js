const express = require('express');
const router = express.Router();
const VotesController = require('../controllers/votes.controller');
const { authenticate } = require('../middleware/auth.middleware');

// All routes require authentication
router.use(authenticate);

// Legacy alias for backward compatibility
router.post('/', VotesController.addVote);

// Legacy alias for backward compatibility
router.delete('/:content_type/:content_id', VotesController.removeVote);

// Legacy alias for backward compatibility
router.get('/:content_type/:content_id', VotesController.getVotes);

module.exports = router;
