const { ServicePlan } = require('./src/models');
const sequelize = require('./src/config/database');

async function update() {
  try {
    await sequelize.authenticate();
    console.log('Connected to database.');
    
    const [affectedCount] = await ServicePlan.update(
      { weekend_surge_price: 150.00 },
      { where: {} }
    );
    
    console.log(`Updated ${affectedCount} service plans with a weekend surge price of ₹150.`);
    process.exit(0);
  } catch (err) {
    console.error('Update failed:', err);
    process.exit(1);
  }
}

update();
