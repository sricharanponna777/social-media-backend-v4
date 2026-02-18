const db = require('../db/database');

class CommentsController {
  async getReplies(req, res) {
    const { commentId } = req.params;
    try {
      // Try post_comments first, then reel_comments
      let result = await db.query(
        `SELECT c.* FROM post_comments c WHERE c.parent_id = $1 AND c.deleted_at IS NULL ORDER BY c.created_at DESC`,
        [commentId]
      );
      if (result.rows.length === 0) {
        result = await db.query(
          `SELECT c.* FROM reel_comments c WHERE c.parent_id = $1 AND c.deleted_at IS NULL ORDER BY c.created_at DESC`,
          [commentId]
        );
      }
      res.json({ replies: result.rows });
    } catch (e) {
      res.status(500).json({ error: 'Server error' });
    }
  }

  async addReply(req, res) {
    const { commentId } = req.params;
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
    try {
      // Determine parent table
      let table = 'post_comments';
      let exists = await db.query('SELECT id, post_id FROM post_comments WHERE id = $1 AND deleted_at IS NULL', [commentId]);
      let cols = '(post_id, user_id, parent_id, content)';
      let values; let returning = '*';
      if (exists.rows.length > 0) {
        const postId = exists.rows[0].post_id;
        values = [postId, req.user.id, commentId, content.trim()];
        table = 'post_comments';
      } else {
        exists = await db.query('SELECT id, reel_id FROM reel_comments WHERE id = $1 AND deleted_at IS NULL', [commentId]);
        if (exists.rows.length === 0) return res.status(404).json({ error: 'Parent comment not found' });
        table = 'reel_comments';
        cols = '(reel_id, user_id, parent_id, content)';
        const reelId = exists.rows[0].reel_id;
        values = [reelId, req.user.id, commentId, content.trim()];
      }

      const result = await db.query(`INSERT INTO ${table} ${cols} VALUES ($1, $2, $3, $4) RETURNING ${returning}`, values);
      res.status(201).json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: 'Server error' });
    }
  }
}

module.exports = new CommentsController();
