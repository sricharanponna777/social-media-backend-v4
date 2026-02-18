const express = require('express')
const router = express.Router()
const VotesController = require('../controllers/votes.controller')
const { authenticate } = require('../middleware/auth.middleware')

router.use(authenticate)

router.post('/', VotesController.addVote)
router.delete('/:content_type/:content_id', VotesController.removeVote)
router.get('/:content_type/:content_id', VotesController.getVotes)

module.exports = router
