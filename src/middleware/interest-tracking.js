const pool = require('../db/database');

const updateInterestAffinity = async (userId, interestId, score) => {
    await pool.query(
        `INSERT INTO user_interest_map (user_id, interest_id, affinity_score)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, interest_id)
         DO UPDATE SET 
            affinity_score = LEAST(1.0, user_interest_map.affinity_score + $3)`,
        [userId, interestId, score]
    );
};

const trackUserInteraction = async (req, res, next) => {
    if (!req.user) return next();

    const interactionWeights = {
        view: 0.01,
        like: 0.05,
        comment: 0.1,
        share: 0.15
    };

    try {
        // Get content creator's interests
        const creatorId = req.params.userId || req.body.userId;
        if (!creatorId) return next();

        const creatorInterests = await pool.query(
            `SELECT interest_id 
             FROM user_interest_map 
             WHERE user_id = $1`,
            [creatorId]
        );

        const interactionType = req.body.type || 'view';
        const weight = interactionWeights[interactionType] || 0.01;

        // Update user's affinity for each of the creator's interests
        for (const row of creatorInterests.rows) {
            await updateInterestAffinity(req.user.id, row.interest_id, weight);
        }

        next();
    } catch (error) {
        console.error('Error tracking user interaction:', error);
        next(); // Continue even if tracking fails
    }
};

module.exports = {
    trackUserInteraction
};
