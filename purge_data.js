const { 
  Order, 
  OrderItem, 
  Booking, 
  Subscription, 
  BookingLog, 
  BookingTracking, 
  BookingAddOn, 
  Payment, 
  Review, 
  Tip, 
  Complaint, 
  SLABreach, 
  sequelize 
} = require('./src/models');

async function purge() {
  console.log('Starting data purge...');
  const transaction = await sequelize.transaction();
  try {
    // Order of deletion highly dependent on foreign keys
    await BookingAddOn.destroy({ where: {}, transaction });
    await BookingLog.destroy({ where: {}, transaction });
    await BookingTracking.destroy({ where: {}, transaction });
    await Review.destroy({ where: {}, transaction });
    await Tip.destroy({ where: {}, transaction });
    await Complaint.destroy({ where: {}, transaction });
    await SLABreach.destroy({ where: {}, transaction });
    await Payment.destroy({ where: {}, transaction });
    
    // Break circular or dependent links
    await Booking.destroy({ where: {}, transaction });
    await Subscription.destroy({ where: {}, transaction });
    
    await OrderItem.destroy({ where: {}, transaction });
    await Order.destroy({ where: {}, transaction });

    await transaction.commit();
    console.log('✅ All transactional data (subscriptions, bookings, orders) has been purged successfully.');
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Data purge failed:', error);
  } finally {
    process.exit();
  }
}

purge();
