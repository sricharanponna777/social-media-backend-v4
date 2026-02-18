const express = require('express');
const router = express.Router();
const { authenticate: auth } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate');
const ReelsController = require('../controllers/reels.controller');
const VotesController = require('../controllers/votes.controller');
const { trackUserInteraction } = require('../middleware/interest-tracking');

// Reel management
router.post('/', auth, ReelsController.createReel);
router.get('/:id', ReelsController.getReel);

router.post('/:id/comments', auth, trackUserInteraction, ReelsController.addComment);
router.get('/:id/comments', ReelsController.getComments);
router.post('/:id/votes', auth, (req, res, next) => {
  req.body.content_type = 'reel';
  req.body.content_id = req.params.id;
  return VotesController.addVote(req, res, next);
});
// Legacy alias for old clients
router.post('/:id/reactions', auth, (req, res, next) => {
  req.body.content_type = 'reel';
  req.body.content_id = req.params.id;
  return VotesController.addVote(req, res, next);
});
 
router.post('/:id/view', auth, trackUserInteraction, ReelsController.trackView);

// Discovery
router.get('/feed/personalized', auth, ReelsController.getFeedReels);
router.get('/discover/trending', ReelsController.getTrendingReels);

module.exports = router;
