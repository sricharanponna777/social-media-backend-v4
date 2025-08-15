const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function initializeDatabase() {
    try {
        // Read the SQL file
        const schemaPath = path.join(__dirname, 'create_tables.sql');
        const schema = await fs.readFile(schemaPath, 'utf8');

        // Execute the schema
        await pool.query(schema);
        console.log('Database schema initialized successfully');

        // Close the pool
        await pool.end();
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    }
}

// Run if called directly (not imported)
if (require.main === module) {
    initializeDatabase();
}

module.exports = { initializeDatabase };
