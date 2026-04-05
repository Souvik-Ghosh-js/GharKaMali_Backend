const sequelize = require('./database');

async function update() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');

    console.log('Updating payments table...');
    await sequelize.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS txn_id VARCHAR(100) AFTER transaction_id;");
    await sequelize.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_for VARCHAR(100) AFTER txn_id;");
    console.log('✅ Payments table updated.');

    process.exit(0);
  } catch (err) {
    console.error('Update failed:', err.message);
    process.exit(1);
  }
}

update();
