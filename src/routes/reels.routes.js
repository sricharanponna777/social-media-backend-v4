const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const ReelsController = require('../controllers/reels.controller');
const { trackUserInteraction } = require('../middleware/interest-tracking');

// Reel management
router.post('/', auth, ReelsController.createReel);
router.get('/:id', ReelsController.getReel);

router.post('/:id/comments', auth, trackUserInteraction, ReelsController.addComment);   
router.post('/:id/view', auth, trackUserInteraction, ReelsController.trackView);

// Discovery
router.get('/feed/personalized', auth, ReelsController.getFeedReels);
router.get('/discover/trending', ReelsController.getTrendingReels);

module.exports = router;
