/**
 * Script to set up the reactions system
 * 
 * This script:
 * 1. Creates the reactions and content_reactions tables if they don't exist
 * 2. Inserts standard reaction types
 * 3. Adds indexes for performance
 */

require('dotenv').config({ path: './src/config/.env' });
const db = require('../db/database');
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

async function setupReactions() {
  try {
    logger.info('Starting reactions system setup...');
    
    // Read and execute the setup SQL file
    const migrationPath = path.join(__dirname, '../db/migrations/20230815_setup_reactions_tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split the SQL into individual statements
    const statements = migrationSQL.split(';').filter(stmt => stmt.trim().length > 0);
    
    // Begin transaction
    await db.query('BEGIN');
    
    // Execute each statement
    for (const statement of statements) {
      await db.query(statement);
      logger.info('Executed SQL statement successfully');
    }
    
    // Commit transaction
    await db.query('COMMIT');
    
    logger.info('Reactions system setup completed successfully.');
    
    // Verify reactions were created
    const reactionsResult = await db.query('SELECT * FROM reactions');
    logger.info(`Available reactions: ${reactionsResult.rows.map(r => r.name).join(', ')}`);
    
    return { success: true };
  } catch (error) {
    // Rollback transaction on error
    await db.query('ROLLBACK');
    logger.error(`Setup failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    // Close database connection
    await db.end();
  }
}

// Run the setup if this script is executed directly
if (require.main === module) {
  setupReactions()
    .then(result => {
      if (result.success) {
        console.log('Reactions system setup completed successfully.');
        process.exit(0);
      } else {
        console.error(`Setup failed: ${result.error}`);
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Unexpected error:', err);
      process.exit(1);
    });
}

module.exports = { setupReactions };