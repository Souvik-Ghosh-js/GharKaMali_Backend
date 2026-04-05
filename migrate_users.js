
const { sequelize } = require('./src/models');

async function migrate() {
  try {
    console.log('Starting manual migration...');
    const queryInterface = sequelize.getQueryInterface();
    
    // Add geofence_id to users
    try {
      await queryInterface.addColumn('users', 'geofence_id', {
        type: require('sequelize').DataTypes.INTEGER,
        references: { model: 'geofences', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        allowNull: true
      });
      console.log('✅ Added geofence_id to users');
    } catch (e) {
      console.log('⚠️ geofence_id might already exist or failed:', e.message);
    }

    // Add service_zone_id to users
    try {
      await queryInterface.addColumn('users', 'service_zone_id', {
        type: require('sequelize').DataTypes.INTEGER,
        references: { model: 'service_zones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        allowNull: true
      });
      console.log('✅ Added service_zone_id to users');
    } catch (e) {
      console.log('⚠️ service_zone_id might already exist or failed:', e.message);
    }

    // Add txn_id to payments
    try {
      await queryInterface.addColumn('payments', 'txn_id', {
        type: require('sequelize').DataTypes.STRING(100),
        allowNull: true
      });
      console.log('✅ Added txn_id to payments');
    } catch (e) {
      console.log('⚠️ txn_id might already exist or failed:', e.message);
    }

    // Add payment_for to payments
    try {
      await queryInterface.addColumn('payments', 'payment_for', {
        type: require('sequelize').DataTypes.STRING(100),
        allowNull: true
      });
      console.log('✅ Added payment_for to payments');
    } catch (e) {
      console.log('⚠️ payment_for might already exist or failed:', e.message);
    }

    console.log('Migration completed!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
