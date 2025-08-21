module.exports = {
  CREATE_USER: `
    INSERT INTO users (
      email, mobile_number, username, password_hash,
      first_name, last_name, avatar_url, bio, location, website, is_private
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
  `,
  GET_USER_BY_EMAIL: `
    SELECT * FROM users
    WHERE email = $1 AND deleted_at IS NULL
  `,
  GET_USER_BY_ID: `
    SELECT * FROM users
    WHERE id = $1 AND deleted_at IS NULL
  `,
  UPDATE_USER: `
    UPDATE users
    SET first_name = $2,
        last_name = $3,
        avatar_url = $4,
        bio = $5,
        location = $6,
        website = $7,
        is_private = $8,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `,
  SEARCH_USERS: `
    SELECT id, username, first_name, last_name, avatar_url
    FROM users
    WHERE (username ILIKE $1 OR full_name ILIKE $1)
      AND deleted_at IS NULL
    LIMIT $2 OFFSET $3
  `,
  DELETE_USER: `
    DELETE FROM users
    WHERE id = $1
  `,
  UPDATE_LAST_ACTIVE: `
    UPDATE users
    SET last_active_at = NOW()
    WHERE id = $1
  `,
  CREATE_OTP: `
    INSERT INTO verification_otps (user_id, otp, expires_at)
    VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
  `,
  GET_OTP: `
    SELECT otp FROM verification_otps
    WHERE user_id = $1 AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `,
  USE_OTP: `
    UPDATE verification_otps
    SET used_at = NOW()
    WHERE user_id = $1 AND otp = $2
  `,
  VERIFY_USER: `
    UPDATE users
    SET email_or_phone_verified = true
    WHERE id = $1
  `
};
