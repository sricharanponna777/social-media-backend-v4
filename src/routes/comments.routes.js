const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const CommentsController = require('../controllers/comments.controller');
const VotesController = require('../controllers/votes.controller');

router.use(authenticate);

router.get('/:commentId/replies', CommentsController.getReplies);
router.post('/:commentId/replies', CommentsController.addReply);

// Votes endpoint for a comment (post or reel)
router.post('/:commentId/votes', (req, res, next) => {
  req.body.content_type = 'comment';
  req.body.content_id = req.params.commentId;
  return VotesController.addVote(req, res, next);
});
// Legacy alias for old clients
router.post('/:commentId/reactions', (req, res, next) => {
  req.body.content_type = 'comment';
  req.body.content_id = req.params.commentId;
  return VotesController.addVote(req, res, next);
});

module.exports = router;
