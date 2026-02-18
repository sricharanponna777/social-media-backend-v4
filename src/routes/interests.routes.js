const express = require('express');
const router = express.Router();
const { authenticate: auth } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate');
const InterestsController = require('../controllers/interests.controller');

// Interest management
router.get('/', InterestsController.listInterests);
router.get('/user', auth, InterestsController.getUserInterests);
router.put('/user', auth, InterestsController.updateUserInterests);

// Recommendations
router.get('/recommended/content', auth, InterestsController.getRecommendedContent);
router.get('/recommended/users', auth, InterestsController.getSuggestedUsers);

module.exports = router;
