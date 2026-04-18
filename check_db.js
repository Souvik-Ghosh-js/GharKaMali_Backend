const { Geofence, User, Order, Subscription } = require('./src/models');
const db = require('./src/config/database');

async function check() {
  try {
    const gf = await Geofence.findAll();
    console.log('--- Geofences ---');
    console.log(JSON.stringify(gf, null, 2));

    const users = await db.query('SELECT id, name, city, geofence_id FROM users WHERE city IS NOT NULL OR geofence_id IS NOT NULL LIMIT 10', { type: db.QueryTypes.SELECT });
    console.log('\n--- Users ---');
    console.log(JSON.stringify(users, null, 2));

    const orders = await db.query('SELECT id, shipping_city, total_amount FROM orders LIMIT 5', { type: db.QueryTypes.SELECT });
    console.log('\n--- Orders ---');
    console.log(JSON.stringify(orders, null, 2));
    
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

check();
