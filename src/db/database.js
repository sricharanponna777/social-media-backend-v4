const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

class Database {
    constructor() {
        this._pool = null;
    }

    get pool() {
        if (!this._pool) {
            this._pool = new Pool({
                user: process.env.DB_USER,
                host: process.env.DB_HOST,
                database: process.env.DB_NAME,
                password: process.env.DB_PASSWORD,
                port: process.env.DB_PORT,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });

            // Log connection events
            this._pool.on('connect', () => {
                console.log('New client connected to database');
            });

            this._pool.on('error', (err) => {
                console.error('Unexpected error on idle client', err);
            });
        }
        return this._pool;
    }

    async query(text, params) {
        const start = Date.now();
        try {
            const result = await this.pool.query(text, params);
            const duration = Date.now() - start;
            const { rows } = result;
            console.log('Executed query', { text, duration, rows });
            return result;
        } catch (error) {
            console.error('Error executing query', { text, error });
            throw error;
        }
    }

    async getClient() {
        const client = await this.pool.connect();
        const query = client.query;
        const release = client.release;

        // Set a timeout of 5 seconds, after which we will log this client's last query
        const timeout = setTimeout(() => {
            console.error('A client has been checked out for more than 5 seconds!');
            console.error(`The last executed query on this client was: ${client.lastQuery}`);
        }, 5000);

        // Monkey patch the query method to keep track of the last query executed
        client.query = (...args) => {
            client.lastQuery = args;
            return query.apply(client, args);
        };

        client.release = () => {
            clearTimeout(timeout);
            client.query = query;
            client.release = release;
            return release.apply(client);
        };

        return client;
    }

    async transaction(callback) {
        const client = await this.getClient();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

// Export singleton instance
module.exports = new Database();
