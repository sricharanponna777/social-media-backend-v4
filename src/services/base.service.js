const db = require('../db/database');

class BaseService {
    constructor(tableName) {
        this.tableName = tableName;
    }

    async findById(id, columns = '*') {
        try {
            const query = `
                SELECT ${columns}
                FROM ${this.tableName}
                WHERE id = $1 AND deleted_at IS NULL
            `;
            const result = await db.query(query, [id]);
            return result.rows[0];
        } catch (error) {
            throw new Error(`Error in ${this.tableName}.findById: ${error.message}`);
        }
    }

    async findOne(conditions, columns = '*') {
        try {
            const { whereClause, values } = this.buildWhereClause(conditions);
            const query = `
                SELECT ${columns}
                FROM ${this.tableName}
                WHERE ${whereClause} AND deleted_at IS NULL
                LIMIT 1
            `;
            const result = await db.query(query, values);
            return result.rows[0];
        } catch (error) {
            throw new Error(`Error in ${this.tableName}.findOne: ${error.message}`);
        }
    }

    async find(conditions = {}, options = {}) {
        try {
            const { whereClause, values } = this.buildWhereClause(conditions);
            const { limit = 10, offset = 0, orderBy = 'created_at DESC' } = options;

            const query = `
                SELECT *
                FROM ${this.tableName}
                WHERE ${whereClause} AND deleted_at IS NULL
                ORDER BY ${orderBy}
                LIMIT $${values.length + 1} OFFSET $${values.length + 2}
            `;

            const result = await db.query(query, [...values, limit, offset]);
            return result.rows;
        } catch (error) {
            throw new Error(`Error in ${this.tableName}.find: ${error.message}`);
        }
    }

    async count(conditions = {}) {
        try {
            const { whereClause, values } = this.buildWhereClause(conditions);
            const query = `
                SELECT COUNT(*) as count
                FROM ${this.tableName}
                WHERE ${whereClause} AND deleted_at IS NULL
            `;
            const result = await db.query(query, values);
            return parseInt(result.rows[0].count);
        } catch (error) {
            throw new Error(`Error in ${this.tableName}.count: ${error.message}`);
        }
    }

    async create(data) {
        try {
            const columns = Object.keys(data);
            const values = Object.values(data);
            const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

            const query = `
                INSERT INTO ${this.tableName} (${columns.join(', ')})
                VALUES (${placeholders})
                RETURNING *
            `;

            const result = await db.query(query, values);
            return result.rows[0];
        } catch (error) {
            throw new Error(`Error in ${this.tableName}.create: ${error.message}`);
        }
    }

    async update(id, data) {
        try {
            const updates = Object.entries(data)
                .map(([key, _], i) => `${key} = $${i + 2}`)
                .join(', ');

            const query = `
                UPDATE ${this.tableName}
                SET ${updates}, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND deleted_at IS NULL
                RETURNING *
            `;

            const values = [id, ...Object.values(data)];
            const result = await db.query(query, values);
            return result.rows[0];
        } catch (error) {
            throw new Error(`Error in ${this.tableName}.update: ${error.message}`);
        }
    }

    async softDelete(id) {
        try {
            const query = `
                UPDATE ${this.tableName}
                SET deleted_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND deleted_at IS NULL
                RETURNING id
            `;
            const result = await db.query(query, [id]);
            return result.rows[0];
        } catch (error) {
            throw new Error(`Error in ${this.tableName}.softDelete: ${error.message}`);
        }
    }

    async hardDelete(id) {
        try {
            const query = `
                DELETE FROM ${this.tableName}
                WHERE id = $1
                RETURNING id
            `;
            const result = await db.query(query, [id]);
            return result.rows[0];
        } catch (error) {
            throw new Error(`Error in ${this.tableName}.hardDelete: ${error.message}`);
        }
    }

    buildWhereClause(conditions) {
        const clauses = [];
        const values = [];
        let paramCount = 1;

        for (const [key, value] of Object.entries(conditions)) {
            if (value === null) {
                clauses.push(`${key} IS NULL`);
            } else if (Array.isArray(value)) {
                values.push(value);
                clauses.push(`${key} = ANY($${paramCount})`);
                paramCount++;
            } else if (typeof value === 'object') {
                for (const [operator, operand] of Object.entries(value)) {
                    values.push(operand);
                    clauses.push(`${key} ${operator} $${paramCount}`);
                    paramCount++;
                }
            } else {
                values.push(value);
                clauses.push(`${key} = $${paramCount}`);
                paramCount++;
            }
        }

        return {
            whereClause: clauses.length ? clauses.join(' AND ') : 'TRUE',
            values
        };
    }
}

module.exports = BaseService;
