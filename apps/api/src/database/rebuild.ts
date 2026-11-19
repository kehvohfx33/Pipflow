import { isDatabaseConfigured, pool } from './pool';
import { rebuildDatabaseFromScratch } from './init';

async function main() {
  const confirmed =
    process.argv.includes('--confirm') || process.env.CONFIRM_DB_REBUILD === 'YES';

  if (!confirmed) {
    console.error(
      'Refusing to wipe database without explicit confirmation. Re-run with `--confirm` or `CONFIRM_DB_REBUILD=YES`.'
    );
    process.exit(1);
  }

  if (!isDatabaseConfigured) {
    console.error('DATABASE_URL is missing or points to an example host. Set a valid PostgreSQL DATABASE_URL first.');
    process.exit(1);
  }

  console.log('Rebuilding PostgreSQL database from scratch...');
  await rebuildDatabaseFromScratch();
  console.log('Clean database rebuild complete. Ready for first-boot owner initialization at /#/_console.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Database rebuild failed:', err instanceof Error ? err.message : err);
  await pool.end().catch(() => {});
  process.exit(1);
});
