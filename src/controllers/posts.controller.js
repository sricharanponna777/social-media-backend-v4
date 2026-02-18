const db = require('../db/database');
const postQueries = require('../queries/posts.queries');
const { createClient } = require('redis')

class PostController {
    async createPost(req, res) {
        const { caption: content, media: mediaUrls, visibility } = req.body;
        
        try {
            const result = await db.query(postQueries.CREATE_POST, [
                req.user.id,
                content,
                mediaUrls, 
                visibility || 'public'
            ]);

            res.status(201).json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }

    async getPost(req, res) {
        try {
            const result = await db.query(postQueries.GET_POST, [
                req.params.id,
                req.user.id
            ]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Post not found' });
            }

            const post = result.rows[0];
            
            if (!post.can_view) {
                return res.status(403).json({ error: 'You do not have permission to view this post' });
            }

            delete post.can_view;
            res.json(post);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }

    async getFeedPosts(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const cacheKey = `feed:${req.user.id}:page:${page}:limit:${limit}`;

        try {
            const client = createClient({
                username: process.env.REDIS_USERNAME,
                password: process.env.REDIS_PASSWORD,
                socket: {
                    host: process.env.REDIS_HOST,
                    port: process.env.REDIS_PORT
                }
            });
            client.on('error', err => console.log('Redis Client Error', err));
            await client.connect();
            const cachedData = await client.get(cacheKey);
            if (cachedData) {
                const posts = JSON.parse(cachedData);
                try {
                    const ids = Array.isArray(posts) ? posts.map(p => p.id).filter(Boolean) : [];
                    if (ids.length) {
                        // Build a parameterized IN clause for fresh counts
                        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
                        const fresh = await db.query(
                            `SELECT id, comments_count FROM posts WHERE id IN (${placeholders})`,
                            ids
                        );
                        const countMap = new Map(fresh.rows.map(r => [r.id, r.comments_count]));
                        for (const p of posts) {
                            if (countMap.has(p.id)) p.comments_count = countMap.get(p.id);
                        }
                    }
                } catch (e) {
                    // If refreshing counts fails, fall back to cached values
                    console.error('Failed to refresh comments_count for cached feed:', e);
                }
                return res.json(posts);
            }

            const result = await db.query(postQueries.GET_FEED_POSTS, [
                req.user.id,
                limit,
                offset
            ]);

            await client.set(cacheKey, JSON.stringify(result.rows), {
                EX: 3600 // Cache for 1 hour
            });

            res.json(
                result.rows,
            );
        } catch (error) {
            console.error(error)
            res.status(500).json({ error: `Server error: ${JSON.stringify(error)}` });
        }
    }

    async getUserPosts(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        try {
            const result = await db.query(postQueries.GET_USER_POSTS, [
                req.params.userId,
                req.user.id,
                limit,
                offset
            ]);

            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }

    // Like/unlike functionality has been replaced by the reactions system

    async deletePost(req, res) {
        try {
            const result = await db.query(postQueries.DELETE_POST, [
                req.params.id,
                req.user.id
            ]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Post not found or unauthorized' });
            }

            res.status(204).send();
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }


    async getPostComments(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        try {
            const result = await db.query(postQueries.GET_POST_COMMENTS, [req.params.id, limit, offset]);
            res.json({ comments: result.rows, page, limit });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }

    async addPostComment(req, res) {
        const { content, parent_id = null } = req.body;
        if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
        try {
            const result = await db.query(postQueries.CREATE_POST_COMMENT, [req.params.id, req.user.id, parent_id, content.trim()]);
            res.status(201).json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }
}

module.exports = new PostController();
