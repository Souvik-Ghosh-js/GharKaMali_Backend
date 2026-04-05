const { sequelize } = require('./src/models');
const { QueryTypes } = require('sequelize');

async function migrate() {
  console.log('--- Migrating Bookings Table ---');
  try {
    await sequelize.authenticate();
    console.log('DB Connected.');

    const newColumns = [
      { name: 'assigned_at', type: 'DATETIME' },
      { name: 'en_route_at', type: 'DATETIME' },
      { name: 'started_at', type: 'DATETIME' },
      { name: 'completed_at', type: 'DATETIME' },
      { name: 'gardener_arrived_at', type: 'DATETIME' },
      { name: 'rated_at', type: 'DATETIME' }
    ];

    for (const col of newColumns) {
      console.log(`Checking column: ${col.name}`);
      const [results] = await sequelize.query(`SHOW COLUMNS FROM bookings LIKE '${col.name}'`);
      if (results.length === 0) {
        console.log(`Adding column: ${col.name}`);
        await sequelize.query(`ALTER TABLE bookings ADD COLUMN ${col.name} ${col.type} NULL`);
        console.log(`Column ${col.name} added.`);
      } else {
        console.log(`Column ${col.name} already exists.`);
      }
    }
    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
