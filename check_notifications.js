const db = require('./src/config/database');

async function checkNotificationsSchema() {
  try {
    const columns = await db.query('DESCRIBE notifications', { type: db.QueryTypes.SELECT });
    console.log('--- Notifications Table Schema ---');
    console.table(columns);
    
    const targetRole = columns.find(c => c.Field === 'target_role');
    if (targetRole) {
      console.log('SUCCESS: target_role column exists.');
    } else {
      console.log('FAILURE: target_role column is missing!');
    }
    
    process.exit(0);
  } catch (e) {
    console.error('Error describing notifications table:', e.message);
    process.exit(1);
  }
}

checkNotificationsSchema();
