import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { logger } from '../config/logger.js';
import { closeDatabase, db } from './client.js';

try {
  await migrate(db, { migrationsFolder: './migrations' });
  logger.info('Database migrations applied');
} catch (error) {
  logger.error({ err: error }, 'Database migration failed');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
