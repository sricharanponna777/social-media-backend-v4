module.exports = {
  CREATE_PRODUCT: `
    INSERT INTO affiliate_products (name, description, price, external_url, platform)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `,
  CREATE_AFFILIATE_LINK: `
    INSERT INTO affiliate_links (user_id, product_id, affiliate_url)
    VALUES ($1, $2, $3)
    RETURNING *
  `,
  RECORD_CLICK: `
    INSERT INTO affiliate_clicks (link_id, user_id, ip_address, user_agent, referer)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `,
  UPDATE_CLICK_COUNT: `
    UPDATE affiliate_links
    SET clicks_count = clicks_count + 1
    WHERE id = $1
  `,
  RECORD_PURCHASE: `
    INSERT INTO affiliate_purchases (click_id, order_id, amount, commission)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `,
  GET_USER_EARNINGS: `
    SELECT total_earned, pending_amount
    FROM user_earnings
    WHERE user_id = $1
  `,
  GET_AFFILIATE_STATS: `
    SELECT al.id, ap.name, al.clicks_count, al.conversions_count
    FROM affiliate_links al
    JOIN affiliate_products ap ON ap.id = al.product_id
    WHERE al.user_id = $1
  `
};
