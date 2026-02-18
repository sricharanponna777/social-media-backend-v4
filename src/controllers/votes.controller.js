const pool = require('../db/database')
const { logger } = require('../utils/logger')
const QUERIES = require('../queries/votes.queries')

const VALID_CONTENT_TYPES = new Set(['post', 'comment', 'story', 'reel'])
const VALID_VOTE_TYPES = new Set(['upvote', 'downvote'])

function normalizeVoteType(rawVoteType, rawLegacyType) {
  const source = String(rawVoteType ?? rawLegacyType ?? '').trim().toLowerCase()
  if (!source) return null
  if (source === 'upvote' || source === 'like' || source === 'love' || source === 'haha' || source === 'wow' || source === 'sad') {
    return 'upvote'
  }
  if (source === 'downvote' || source === 'dislike' || source === 'angry') {
    return 'downvote'
  }
  return null
}

class VotesController {
  constructor() {
    this.resolveContentOwner = this.resolveContentOwner.bind(this)
    this.addVote = this.addVote.bind(this)
    this.removeVote = this.removeVote.bind(this)
    this.getVotes = this.getVotes.bind(this)
  }

  async resolveContentOwner(contentType, contentId) {
    if (contentType === 'post') return pool.query(QUERIES.GET_POST_OWNER, [contentId])
    if (contentType === 'comment') return pool.query(QUERIES.GET_COMMENT_OWNER, [contentId])
    if (contentType === 'story') return pool.query(QUERIES.GET_STORY_OWNER, [contentId])
    return pool.query(QUERIES.GET_REEL_OWNER, [contentId])
  }

  async addVote(req, res) {
    try {
      const { content_type, content_id, vote_type, type } = req.body
      const contentType = String(content_type || '').trim().toLowerCase()
      const contentId = String(content_id || '').trim()
      const voteType = normalizeVoteType(vote_type, type)

      if (!VALID_CONTENT_TYPES.has(contentType)) {
        return res.status(400).json({ error: 'Invalid content type' })
      }

      if (!contentId) {
        return res.status(400).json({ error: 'content_id is required' })
      }

      if (!voteType || !VALID_VOTE_TYPES.has(voteType)) {
        return res.status(400).json({ error: 'Invalid vote type' })
      }

      const ownerResult = await this.resolveContentOwner(contentType, contentId)
      if (ownerResult.rows.length === 0) {
        return res.status(404).json({ error: 'Content not found' })
      }

      const result = await pool.query(QUERIES.UPSERT_VOTE, [
        req.user.id,
        contentType,
        contentId,
        voteType,
      ])

      logger.info(`User ${req.user.id} voted ${voteType} on ${contentType} ${contentId}`)
      return res.status(201).json({
        success: true,
        vote: result.rows[0],
      })
    } catch (error) {
      logger.error(`Error adding vote: ${error.message}`)
      return res.status(500).json({ error: 'Server error' })
    }
  }

  async removeVote(req, res) {
    try {
      const contentType = String(req.params.content_type || '').trim().toLowerCase()
      const contentId = String(req.params.content_id || '').trim()

      if (!VALID_CONTENT_TYPES.has(contentType)) {
        return res.status(400).json({ error: 'Invalid content type' })
      }

      if (!contentId) {
        return res.status(400).json({ error: 'content_id is required' })
      }

      const result = await pool.query(QUERIES.REMOVE_VOTE, [req.user.id, contentType, contentId])
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Vote not found' })
      }

      logger.info(`User ${req.user.id} removed vote from ${contentType} ${contentId}`)
      return res.status(204).send()
    } catch (error) {
      logger.error(`Error removing vote: ${error.message}`)
      return res.status(500).json({ error: 'Server error' })
    }
  }

  async getVotes(req, res) {
    try {
      const contentType = String(req.params.content_type || '').trim().toLowerCase()
      const contentId = String(req.params.content_id || '').trim()

      if (!VALID_CONTENT_TYPES.has(contentType)) {
        return res.status(400).json({ error: 'Invalid content type' })
      }

      if (!contentId) {
        return res.status(400).json({ error: 'content_id is required' })
      }

      const [votesResult, countsResult, userVoteResult] = await Promise.all([
        pool.query(QUERIES.GET_VOTES, [contentType, contentId]),
        pool.query(QUERIES.GET_COUNTS, [contentType, contentId]),
        pool.query(QUERIES.GET_USER_VOTE, [req.user.id, contentType, contentId]),
      ])

      const counts = countsResult.rows.map((row) => ({
        name: row.vote_type,
        vote_type: row.vote_type,
        count: Number(row.count || 0),
      }))

      return res.json({
        votes: votesResult.rows,
        counts,
        total: votesResult.rows.length,
        user_vote: userVoteResult.rows[0]?.vote_type || null,
      })
    } catch (error) {
      logger.error(`Error getting votes: ${error.message}`)
      return res.status(500).json({ error: 'Server error' })
    }
  }
}

module.exports = new VotesController()
