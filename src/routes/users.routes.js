const express = require('express');
const router = express.Router();
const UserController = require('../controllers/users.controller');
const { auth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { userValidation } = require('../validations/user.validation');

// Public routes
router.post('/register', validate(userValidation.register), UserController.register);
router.post('/login', validate(userValidation.login), UserController.login);
router.post('/verify-otp', UserController.verifyOtp);


// Protected routes
router.post('/verify-token', UserController.verifyTokenRoute);
router.get('/profile/:id', auth, UserController.getProfile);
router.put('/profile', auth, validate(userValidation.updateProfile), UserController.updateProfile);
router.get('/search', auth, UserController.searchUsers);
router.delete('/account', auth, UserController.deleteAccount);

module.exports = router;
