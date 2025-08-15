const express = require('express');
const router = express.Router();
const friendsController = require('../controllers/friends.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { body, param } = require('express-validator');


router.get('/', authenticate, friendsController.getFriends);

router.get('/requests', authenticate, friendsController.getFriendRequests)

router.post(
  '/request',
  authenticate,
  [
    body('receiverId')
      .notEmpty()
      .withMessage('Receiver ID is required')
      .isUUID()
      .withMessage('Receiver ID must be a valid UUID')
  ],
  validate,
  friendsController.sendFriendRequest
);

router.post(
  '/request/:requestId/accept',
  authenticate,
  [
    param('requestId')
      .isUUID()
      .withMessage('Request ID must be a valid UUID')
  ],
  validate,
  friendsController.acceptFriendRequest
);

router.post(
  '/request/:requestId/reject',
  authenticate,
  [
    param('requestId')
      .isUUID()
      .withMessage('Request ID must be a valid UUID')
  ],
  validate,
  friendsController.rejectFriendRequest
);

router.post(
  '/:friendshipId/block',
  authenticate,
  [
    param('friendshipId')
      .isUUID()
      .withMessage('Friendship ID must be a valid UUID')
  ],
  validate,
  friendsController.blockFriend
);

router.delete(
  '/:friendshipId',
  authenticate,
  [
    param('friendshipId')
      .isUUID()
      .withMessage('Friendship ID must be a valid UUID')
  ],
  validate,
  friendsController.removeFriend
);

router.get(
  '/status/:otherUserId',
  authenticate,
  [
    param('otherUserId')
      .isUUID()
      .withMessage('User ID must be a valid UUID')
  ],
  validate,
  friendsController.checkFriendshipStatus
);

module.exports = router;