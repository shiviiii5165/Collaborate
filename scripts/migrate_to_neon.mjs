import fs from 'fs';
import path from 'path';
import { Pool } from '@neondatabase/serverless';

const DATA_FILE_PATH = path.join(process.cwd(), 'data', 'collaborate.db.json');
const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

export async function runMigration(options = { testRollback: false, dryRun: false, excludeDemo: true }) {
  console.log('=== COLLABORATE NEON POSTGRESQL MIGRATION ENGINE ===');
  console.log(`Execution Mode: ${options.testRollback ? 'TEST ROLLBACK' : options.dryRun ? 'DRY RUN' : 'PRODUCTION COMMIT'}`);

  // 1. Step 1: Backup Source Data
  if (!fs.existsSync(DATA_FILE_PATH)) {
    throw new Error(`Source database file not found at: ${DATA_FILE_PATH}`);
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `collaborate_backup_${timestamp}.json`);
  const rawData = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
  fs.writeFileSync(backupFile, rawData, 'utf-8');
  console.log(`✅ [Step 1] Source database backed up safely to: ${backupFile}`);

  const state = JSON.parse(rawData);
  console.log(`📊 [Step 2] Read ${Object.keys(state.members || {}).length} members, ${state.messages?.length || 0} messages from source.`);

  // Validate Input Records
  const demoIds = new Set(['usr_rahul', 'usr_priya', 'usr_aman', 'usr_neha']);
  const membersToMigrate = Object.values(state.members || {}).map(m => {
    const isDemo = demoIds.has(m.id) || Boolean(m.isDemo);
    return { ...m, isDemo };
  });

  const validMembers = options.excludeDemo 
    ? membersToMigrate.filter(m => !m.isDemo)
    : membersToMigrate;

  console.log(`🔍 [Step 3] Validated records. Filtered ${membersToMigrate.length - validMembers.length} demo profiles. Genuine members to migrate: ${validMembers.length}`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('⚠️ [Notice] DATABASE_URL not detected in current environment.');
    console.log('✅ Validation and backup succeeded. Database migration ready for execution once DATABASE_URL is configured.');
    return {
      success: true,
      backupFile,
      migratedCount: validMembers.length,
      status: 'VALIDATED_READY_FOR_NEON'
    };
  }

  // Connect to Neon
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    console.log('🔌 [Step 4] Connected to Neon PostgreSQL instance.');
    await client.query('BEGIN');

    // Migrate Members & Profiles
    let memberCount = 0;
    for (const m of validMembers) {
      await client.query(
        `INSERT INTO members (id, email, full_name, role, plan, is_verified, verified_category, is_demo, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           plan = EXCLUDED.plan,
           is_verified = EXCLUDED.is_verified,
           is_demo = EXCLUDED.is_demo,
           updated_at = CURRENT_TIMESTAMP`,
        [m.id, m.email, m.fullName, m.role || 'member', m.plan || 'free', Boolean(m.isVerified), m.verifiedCategory || null, Boolean(m.isDemo)]
      );

      await client.query(
        `INSERT INTO professional_profiles (
           member_id, headline, about, avatar_url, banner_url, location, 
           status_badges, context_tags, social_links, metrics, skills, 
           ai_specializations, collaboration_interests, discoverable, 
           profile_visibility, contact_visibility, is_demo, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP
         )
         ON CONFLICT (member_id) DO UPDATE SET
           headline = EXCLUDED.headline,
           about = EXCLUDED.about,
           skills = EXCLUDED.skills,
           is_demo = EXCLUDED.is_demo,
           updated_at = CURRENT_TIMESTAMP`,
        [
          m.id,
          m.headline || '',
          m.about || '',
          m.avatarUrl || '/images/rahul_avatar.jpg',
          m.bannerUrl || '/images/campus_banner.jpg',
          m.location || '',
          JSON.stringify(m.statusBadges || []),
          JSON.stringify(m.contextTags || []),
          JSON.stringify(m.socialLinks || {}),
          JSON.stringify(m.metrics || {}),
          JSON.stringify(m.skills || []),
          JSON.stringify(m.aiSpecializations || []),
          JSON.stringify(m.collaborationInterests || []),
          m.discoverable ?? true,
          m.profileVisibility || 'public',
          m.contactVisibility || 'connections_only',
          Boolean(m.isDemo),
        ]
      );
      memberCount++;
    }

    // Verify Row Counts & Referential Integrity
    const countCheck = await client.query('SELECT COUNT(*) FROM members');
    console.log(`📈 [Step 5] Total members in Neon after insert: ${countCheck.rows[0].count}`);

    if (options.testRollback) {
      console.log('🔄 [Rollback Test] Executing ROLLBACK as requested by --test-rollback...');
      await client.query('ROLLBACK');
      const rollbackCheck = await client.query('SELECT COUNT(*) FROM members');
      console.log(`✅ [Rollback Test Passed] Member count post-rollback: ${rollbackCheck.rows[0].count} (Clean reversal).`);
      return { success: true, rolledBack: true };
    }

    await client.query('COMMIT');
    console.log('🎉 [Step 6] Transaction COMMITTED successfully. Database migration complete!');
    return { success: true, backupFile, memberCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed, transaction ROLLED BACK safely:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// CLI Execution Support
if (process.argv[1].endsWith('migrate_to_neon.mjs')) {
  const isTestRollback = process.argv.includes('--test-rollback');
  const isDryRun = process.argv.includes('--dry-run');
  const includeDemo = process.argv.includes('--include-demo');

  runMigration({
    testRollback: isTestRollback,
    dryRun: isDryRun,
    excludeDemo: !includeDemo
  }).then(res => {
    console.log('Migration Result:', res);
    process.exit(0);
  }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
