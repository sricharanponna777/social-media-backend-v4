const express = require('express');
const router = express.Router();
const PostController = require('../controllers/posts.controller');
const { authenticate } = require('../middleware/auth.middleware');
const VotesController = require('../controllers/votes.controller');
const { validatePost } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

router.post('/', validatePost, PostController.createPost);
router.get('/feed', PostController.getFeedPosts);
router.get('/user/:userId', PostController.getUserPosts);
router.get('/:id', PostController.getPost);
router.get('/:id/comments', PostController.getPostComments);
router.post('/:id/comments', PostController.addPostComment);
// Votes endpoint for posts
router.post('/:id/votes', (req, res, next) => {
  req.body.content_type = 'post';
  req.body.content_id = req.params.id;
  return VotesController.addVote(req, res, next);
});
// Legacy alias for old clients
router.post('/:id/reactions', (req, res, next) => {
  req.body.content_type = 'post';
  req.body.content_id = req.params.id;
  return VotesController.addVote(req, res, next);
});
// Like/unlike routes have been replaced by the reactions system
router.delete('/:id', PostController.deletePost);

module.exports = router;
