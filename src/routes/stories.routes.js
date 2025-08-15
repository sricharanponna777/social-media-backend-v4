const express = require('express');
const router = express.Router();
const StoryController = require('../controllers/stories.controller');
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
    validateStory.view,
    StoryController.viewStory
);

// Get story statistics (only for story owner)
router.get('/:id/stats', StoryController.getStoryStats);

// Delete story
router.delete('/:id', StoryController.deleteStory);

module.exports = router;
