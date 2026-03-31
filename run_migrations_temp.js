const sequelize = require('./src/config/database');

async function migrate() {
  try {
    await sequelize.authenticate();
    console.log('Connection has been established successfully.');
    
    try {
      await sequelize.query(`ALTER TABLE taglines ADD COLUMN image_url VARCHAR(500);`);
      console.log('Added image_url to taglines');
    } catch (e) { console.log('image_url might already exist', e.message); }
    
    try {
      await sequelize.query(`ALTER TABLE products ADD COLUMN tags JSON;`);
      console.log('Added tags to products');
    } catch (e) { console.log('tags might already exist', e.message); }

    console.log('Migration complete');
    process.exit(0);
  } catch (err) {
    console.error('Unable to connect to the database:', err);
    process.exit(1);
  }
}

migrate();
