import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDatabaseConnection, DATABASE_TABLES } from '../lib/databaseStorage.js';

async function queryWithPoolFactory(poolFactory, text, values = []) {
  const pool = await poolFactory();
  return pool.query(text, values);
}

export async function inspectDatabaseSchema({ databaseUrl = process.env.DATABASE_URL ?? '', poolFactory = null } = {}) {
  const health = await checkDatabaseConnection({
    databaseUrl,
    poolFactory,
  });

  if (!health.canConnect) {
    return {
      ok: false,
      canConnect: false,
      error: health.error,
      tables: [],
    };
  }

  const tableNames = Object.values(DATABASE_TABLES).map((table) => table.name);
  const placeholders = tableNames.map((_, index) => `$${index + 1}`).join(', ');
  const tablesResult = await queryWithPoolFactory(
    poolFactory,
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${placeholders})
    `,
    tableNames,
  );
  const existingTables = new Set(tablesResult.rows.map((row) => row.table_name));

  const tableChecks = await Promise.all(
    Object.values(DATABASE_TABLES).map(async (table) => {
      const columnsResult = await queryWithPoolFactory(
        poolFactory,
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
        `,
        [table.name],
      );
      const existingColumns = new Set(columnsResult.rows.map((row) => row.column_name));
      const missingColumns = table.columns.filter((column) => !existingColumns.has(column));

      return {
        table: table.name,
        exists: existingTables.has(table.name),
        missingColumns,
      };
    }),
  );

  return {
    ok: tableChecks.every((item) => item.exists && item.missingColumns.length === 0),
    canConnect: true,
    error: '',
    tables: tableChecks,
  };
}

function summarizeInspection(result) {
  const tablesPass = result.canConnect && result.tables.every((table) => table.exists);
  const columnsPass = result.canConnect && result.tables.every((table) => table.missingColumns.length === 0);
  const authorityExpected = result.canConnect && tablesPass && columnsPass ? 'AUTHORITATIVE' : 'LOCAL_ONLY';

  return {
    connectionPass: Boolean(result.canConnect),
    tablesPass,
    columnsPass,
    authorityExpected,
  };
}

function printInspection(result) {
  const summary = summarizeInspection(result);
  const icon = (pass) => (pass ? 'PASS' : 'FAIL');

  console.log(`Database connection: ${icon(summary.connectionPass)}`);
  if (!summary.connectionPass && result.error) {
    console.log(`Error: ${result.error}`);
  }

  console.log(`Required tables: ${icon(summary.tablesPass)}`);
  console.log(`Required columns: ${icon(summary.columnsPass)}`);
  console.log(`Storage authority expected: ${summary.authorityExpected}`);

  const missingTables = result.tables.filter((table) => !table.exists).map((table) => table.table);
  const missingColumns = result.tables
    .filter((table) => table.exists && table.missingColumns.length > 0)
    .map((table) => `${table.table} -> ${table.missingColumns.join(', ')}`);

  if (missingTables.length) {
    console.log(`Missing tables: ${missingTables.join(', ')}`);
  }

  if (missingColumns.length) {
    console.log('Missing columns:');
    missingColumns.forEach((line) => console.log(`- ${line}`));
  }

  if (summary.authorityExpected !== 'AUTHORITATIVE') {
    const nextAction = !summary.connectionPass
      ? 'Next action: verify DATABASE_URL, DATABASE_SSL, network access, and database allowlist/settings.'
      : !summary.tablesPass || !summary.columnsPass
        ? 'Next action: run database/schema.sql manually, then re-run npm run db:check.'
        : 'Next action: inspect database configuration and rerun the health check.';
    console.log(nextAction);
  } else {
    console.log('Next action: deploy or restart the app, then confirm /proof reports Authoritative.');
  }

  return summary;
}

export async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Database connection: FAIL');
    console.error('Required tables: FAIL');
    console.error('Required columns: FAIL');
    console.error('Storage authority expected: LOCAL_ONLY');
    console.error('Next action: set DATABASE_URL and re-run npm run db:check.');
    process.exit(1);
  }

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
  });

  try {
    const result = await inspectDatabaseSchema({
      databaseUrl: process.env.DATABASE_URL,
      poolFactory: () => pool,
    });
    const summary = printInspection(result);

    if (!summary.connectionPass) {
      process.exit(1);
    }

    if (summary.tablesPass && summary.columnsPass) {
      return;
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
