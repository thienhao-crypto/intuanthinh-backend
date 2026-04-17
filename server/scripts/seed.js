import defaultSiteData from '../../client/src/data/siteData.js';
import { getDatabaseConfig, openDatabase, seedDatabase } from '../lib/database.js';

const db = await openDatabase();
const result = await seedDatabase(db, defaultSiteData);
await db.end();

console.log(
  JSON.stringify(
    {
      message: 'MySQL database seeded successfully.',
      database: getDatabaseConfig(),
      counts: result
    },
    null,
    2
  )
);
