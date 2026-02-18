const express = require('express');
const router = express.Router();
const StoryController = require('../controllers/stories.controller');
const VotesController = require('../controllers/votes.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateStory } = require('../middleware/validation.middleware');
const fileService = require('../services/file.service');

// All routes require authentication
router.use(authenticate);

// Create new story
router.post('/',
    fileService.getUploadMiddleware('media', 1),
    validateStory.create,
    StoryController.createStory
);

// Get stories for feed
router.get('/feed', StoryController.getFeedStories);

// Get user's stories
router.get('/user/:userId', StoryController.getUserStories);

// Get single story
router.get('/:id', StoryController.getStory);

// View a story
router.post('/:storyId/view',
    StoryController.viewStory
);

// Get story statistics (only for story owner)
router.get('/:id/stats', StoryController.getStoryStats);

// Delete story
router.delete('/:id', StoryController.deleteStory);

// Votes endpoint for stories
router.post('/:id/votes', (req, res, next) => {
    req.body.content_type = 'story';
    req.body.content_id = req.params.id;
    return VotesController.addVote(req, res, next);
});
// Legacy alias for old clients
router.post('/:id/reactions', (req, res, next) => {
    req.body.content_type = 'story';
    req.body.content_id = req.params.id;
    return VotesController.addVote(req, res, next);
});

module.exports = router;
