const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const AffiliateController = require('../controllers/affiliate.controller');

router.post('/products', auth, AffiliateController.createProduct);
router.post('/links', auth, AffiliateController.createAffiliateLink);
router.get('/links/stats', auth, AffiliateController.getAffiliateStats);
router.post('/track/click/:linkId', AffiliateController.trackClick);
router.post('/track/purchase', auth, AffiliateController.trackPurchase);
router.get('/earnings', auth, AffiliateController.getUserEarnings);

module.exports = router;
