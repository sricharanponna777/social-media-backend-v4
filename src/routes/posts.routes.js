const express = require('express');
const router = express.Router();
const PostController = require('../controllers/posts.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validatePost } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

router.post('/', validatePost, PostController.createPost);
router.get('/feed', PostController.getFeedPosts);
router.get('/user/:userId', PostController.getUserPosts);
router.get('/:id', PostController.getPost);
// Like/unlike routes have been replaced by the reactions system
router.delete('/:id', PostController.deletePost);

module.exports = router;
