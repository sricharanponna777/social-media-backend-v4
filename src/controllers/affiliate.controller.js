const pool = require('../db/database');
const { AppError } = require('../utils/errors');
const { logger } = require('../utils/logger');
const QUERIES = require('../queries/affiliate.queries');

class AffiliateController {
    async createProduct(req, res) {
        const { name, description, price, external_url, platform } = req.body;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            
            const result = await client.query(
                QUERIES.CREATE_PRODUCT,
                [name, description, price, external_url, platform]
            );

            await client.query('COMMIT');
            logger.info(`Created new affiliate product: ${name}`);
            res.status(201).json(result.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error creating affiliate product:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async createAffiliateLink(req, res) {
        const { product_id } = req.body;
        const user_id = req.user.id;
        const affiliate_url = this.generateAffiliateUrl(user_id, product_id);

        const result = await pool.query(
            QUERIES.CREATE_AFFILIATE_LINK,
            [user_id, product_id, affiliate_url]
        );

        logger.info(`Created affiliate link for user ${user_id} and product ${product_id}`);
        res.status(201).json(result.rows[0]);
    }

    async trackClick(req, res) {
        const { linkId } = req.params;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const clickResult = await client.query(
                QUERIES.RECORD_CLICK,
                [
                    linkId,
                    req.user?.id,
                    req.ip,
                    req.headers['user-agent'],
                    req.headers.referer
                ]
            );

            // Update click count atomically
            await client.query(
                QUERIES.UPDATE_CLICK_COUNT,
                [linkId]
            );

            await client.query('COMMIT');
            logger.info(`Recorded click for affiliate link ${linkId}`);
            res.status(200).json(clickResult.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error tracking affiliate click:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async trackPurchase(req, res) {
        const { click_id, order_id, amount } = req.body;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Calculate commission (example: 10%)
            const commission = amount * 0.10;

            const purchaseResult = await client.query(
                QUERIES.RECORD_PURCHASE,
                [click_id, order_id, amount, commission]
            );

            // Update user earnings atomically
            await client.query(
                `INSERT INTO user_earnings (user_id, total_earned, pending_amount)
                 VALUES (
                     (SELECT user_id FROM affiliate_links WHERE id = 
                         (SELECT link_id FROM affiliate_clicks WHERE id = $1)),
                     $2,
                     $2
                 )
                 ON CONFLICT (user_id) DO UPDATE
                 SET total_earned = user_earnings.total_earned + $2,
                     pending_amount = user_earnings.pending_amount + $2`,
                [click_id, commission]
            );

            await client.query('COMMIT');
            logger.info(`Recorded purchase for click ${click_id}, amount: ${amount}`);
            res.status(200).json(purchaseResult.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error tracking affiliate purchase:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async getUserEarnings(req, res) {
        const result = await pool.query(
            QUERIES.GET_USER_EARNINGS,
            [req.user.id]
        );

        res.json(result.rows[0] || { total_earned: 0, pending_amount: 0 });
    }

    async getAffiliateStats(req, res) {
        const result = await pool.query(
            QUERIES.GET_AFFILIATE_STATS,
            [req.user.id]
        );

        res.json(result.rows);
    }

    // Helper method
    generateAffiliateUrl(userId, productId) {
        const baseUrl = process.env.AFFILIATE_BASE_URL || 'https://example.com/aff';
        return `${baseUrl}/${userId}/${productId}`;
    }
}

module.exports = new AffiliateController();
