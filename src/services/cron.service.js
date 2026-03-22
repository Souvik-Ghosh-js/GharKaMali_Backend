const cron = require('node-cron');
const { Op } = require('sequelize');
const moment = require('moment');
const {
  Subscription, Booking, GardenerProfile, RewardPenalty,
  User, ServiceZone, ServicePlan, PriceHikeSchedule, PriceHikeLog
} = require('../models');
const { sendWhatsApp, templates } = require('./otp.service');

// ── 1. Check expired subscriptions — daily at midnight ──────────────────────
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Checking expired subscriptions...');
  try {
    const expired = await Subscription.findAll({
      where: { status: 'active', end_date: { [Op.lt]: new Date() } }
    });
    for (const sub of expired) {
      await sub.update({ status: 'expired' });
      const customer = await User.findByPk(sub.customer_id);
      if (customer) {
        await sendWhatsApp(
          customer.phone,
          `🌿 *Ghar Ka Mali*\nHi ${customer.name}! Your subscription has expired. Renew to continue enjoying our services! 🌱`
        );
      }
    }
    console.log(`[CRON] Marked ${expired.length} subscriptions as expired`);
  } catch (err) {
    console.error('[CRON] Subscription expiry error:', err.message);
  }
});

// ── 2. Auto reward/penalty calculations — weekly on Monday 9AM ──────────────
cron.schedule('0 9 * * 1', async () => {
  console.log('[CRON] Calculating weekly rewards & penalties...');
  try {
    const oneWeekAgo = moment().subtract(7, 'days').toDate();
    const gardeners = await GardenerProfile.findAll({
      include: [{ model: User, as: 'user', where: { is_active: true, is_approved: true } }]
    });

    for (const g of gardeners) {
      const weekBookings = await Booking.findAll({
        where: { gardener_id: g.user_id, created_at: { [Op.gte]: oneWeekAgo } }
      });
      if (weekBookings.length < 2) continue; // not enough data

      const completed  = weekBookings.filter(b => b.status === 'completed');
      const cancelled  = weekBookings.filter(b => b.status === 'cancelled');
      const rated      = completed.filter(b => b.rating !== null);
      const avgRating  = rated.length > 0 ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : 0;
      const completionRate = (completed.length / weekBookings.length) * 100;

      // ── On-time arrival check ────────────────────────────────────────
      const arrivedJobs = completed.filter(b => b.gardener_arrived_at && b.scheduled_time);
      let lateArrivals = 0;
      for (const b of arrivedJobs) {
        const scheduledMoment = moment(`${b.scheduled_date} ${b.scheduled_time}`);
        const arrivedMoment   = moment(b.gardener_arrived_at);
        if (arrivedMoment.diff(scheduledMoment, 'minutes') > 30) lateArrivals++;
      }
      const lateRate = arrivedJobs.length > 0 ? (lateArrivals / arrivedJobs.length) * 100 : 0;

      // ── Reward: high completion + high rating + punctual ─────────────
      if (completionRate >= 90 && avgRating >= 4.5 && completed.length >= 5 && lateRate < 20) {
        const bonusAmt = lateRate < 10 ? 250 : 200; // extra bonus for very punctual
        await RewardPenalty.create({
          gardener_id: g.user_id, type: 'reward', amount: bonusAmt,
          reason: 'Weekly performance bonus',
          description: `Completion: ${completionRate.toFixed(0)}%, Rating: ${avgRating.toFixed(1)}, Late arrivals: ${lateArrivals}/${arrivedJobs.length}`,
          status: 'applied', applied_at: new Date()
        });
        await GardenerProfile.increment({ total_earnings: bonusAmt }, { where: { user_id: g.user_id } });
      }

      // ── Penalty: low completion rate ─────────────────────────────────
      if (completionRate < 70 && weekBookings.length >= 3) {
        await RewardPenalty.create({
          gardener_id: g.user_id, type: 'penalty', amount: 100,
          reason: 'Low completion rate',
          description: `Completion rate: ${completionRate.toFixed(0)}% (${completed.length}/${weekBookings.length} jobs)`,
          status: 'applied', applied_at: new Date()
        });
      }

      // ── Penalty: high late-arrival rate ─────────────────────────────
      if (lateRate > 40 && arrivedJobs.length >= 3) {
        await RewardPenalty.create({
          gardener_id: g.user_id, type: 'penalty', amount: 75,
          reason: 'Punctuality penalty',
          description: `${lateArrivals} out of ${arrivedJobs.length} arrivals were 30+ minutes late`,
          status: 'applied', applied_at: new Date()
        });
      }
    }
    console.log('[CRON] Weekly rewards/penalties calculated');
  } catch (err) {
    console.error('[CRON] Reward calc error:', err.message);
  }
});

// ── 3. Send tomorrow's booking reminders — daily at 8PM ─────────────────────
cron.schedule('0 20 * * *', async () => {
  console.log('[CRON] Sending tomorrow reminders...');
  try {
    const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
    const bookings = await Booking.findAll({
      where: { scheduled_date: tomorrow, status: { [Op.in]: ['assigned', 'pending'] } },
      include: [{ model: User, as: 'customer' }, { model: User, as: 'gardener' }]
    });
    for (const b of bookings) {
      if (b.customer) {
        await sendWhatsApp(
          b.customer.phone,
          `🌿 *Ghar Ka Mali*\nReminder: Your garden visit is tomorrow (${tomorrow}). Gardener: ${b.gardener?.name || 'being assigned'}. Be available to share OTP! 🌱`
        );
      }
    }
    console.log(`[CRON] Sent ${bookings.length} reminders`);
  } catch (err) {
    console.error('[CRON] Reminder error:', err.message);
  }
});

// ── 4. Auto price-hike — check scheduled hikes every day at 2AM ─────────────
cron.schedule('0 2 * * *', async () => {
  console.log('[CRON] Checking scheduled price hikes...');
  try {
    const due = await PriceHikeSchedule.findAll({
      where: {
        is_applied: false,
        scheduled_at: { [Op.lte]: new Date() }
      }
    });

    for (const schedule of due) {
      const { percentage, reason, zone_ids, plan_ids, created_by } = schedule;
      const results = [];

      if (zone_ids && zone_ids.length > 0) {
        for (const zid of zone_ids) {
          const zone = await ServiceZone.findByPk(zid);
          if (zone) {
            const newPrice = parseFloat((zone.base_price * (1 + percentage / 100)).toFixed(2));
            await PriceHikeLog.create({
              zone_id: zid, old_price: zone.base_price, new_price: newPrice,
              hike_percentage: percentage, reason: reason || 'Scheduled auto hike',
              applied_by: created_by
            });
            await zone.update({ base_price: newPrice });
            results.push(`Zone ${zone.name}: ₹${zone.base_price} → ₹${newPrice}`);
          }
        }
      }

      if (plan_ids && plan_ids.length > 0) {
        for (const pid of plan_ids) {
          const plan = await ServicePlan.findByPk(pid);
          if (plan) {
            const newPrice = parseFloat((plan.price * (1 + percentage / 100)).toFixed(2));
            await PriceHikeLog.create({
              plan_id: pid, old_price: plan.price, new_price: newPrice,
              hike_percentage: percentage, reason: reason || 'Scheduled auto hike',
              applied_by: created_by
            });
            await plan.update({ price: newPrice });
            results.push(`Plan ${plan.name}: ₹${plan.price} → ₹${newPrice}`);
          }
        }
      }

      await schedule.update({ is_applied: true, applied_at: new Date() });
      console.log(`[CRON] Applied scheduled price hike "${schedule.name}": ${results.join(', ')}`);
    }

    if (due.length === 0) console.log('[CRON] No price hikes due today');
  } catch (err) {
    console.error('[CRON] Price hike error:', err.message);
  }
});

// ── 5. Auto-reassign orphaned bookings — every 30 minutes ────────────────────
cron.schedule('*/30 * * * *', async () => {
  try {
    const twoHoursAgo = moment().subtract(2, 'hours').toDate();
    // Bookings assigned but gardener hasn't moved to en_route in 2+ hours
    const orphaned = await Booking.findAll({
      where: {
        status: 'assigned',
        updated_at: { [Op.lt]: twoHoursAgo },
        scheduled_date: { [Op.gte]: moment().format('YYYY-MM-DD') }
      }
    });

    for (const booking of orphaned) {
      // Find another available gardener
      const newGardener = await GardenerProfile.findOne({
        where: {
          is_available: true,
          user_id: { [Op.ne]: booking.gardener_id }
        },
        include: [{ model: User, as: 'user', where: { is_active: true, is_approved: true } }]
      });

      if (newGardener) {
        const oldGardenerId = booking.gardener_id;
        await booking.update({ gardener_id: newGardener.user_id });
        console.log(`[CRON] Reassigned booking ${booking.booking_number} from gardener ${oldGardenerId} to ${newGardener.user_id}`);

        const customer = await User.findByPk(booking.customer_id);
        if (customer) {
          await sendWhatsApp(
            customer.phone,
            `🌿 *Ghar Ka Mali*\nYour gardener has been reassigned for booking ${booking.booking_number}. New gardener will arrive as scheduled. 🌱`
          );
        }
      }
    }
    if (orphaned.length > 0) console.log(`[CRON] Processed ${orphaned.length} orphaned bookings`);
  } catch (err) {
    console.error('[CRON] Reassign error:', err.message);
  }
});

// ── 6. Mark failed visits (customer unavailable) — check every hour ──────────
cron.schedule('0 * * * *', async () => {
  try {
    const oneHourAgo = moment().subtract(60, 'minutes').toDate();
    // Bookings where gardener marked 'arrived' but OTP still not verified after 45 min
    const stuck = await Booking.findAll({
      where: {
        status: 'arrived',
        gardener_arrived_at: { [Op.lt]: moment().subtract(45, 'minutes').toDate() },
        otp_verified: false
      }
    });

    for (const booking of stuck) {
      await booking.update({ status: 'failed' });
      const customer = await User.findByPk(booking.customer_id);
      const gardener = await User.findByPk(booking.gardener_id);
      if (customer) {
        await sendWhatsApp(
          customer.phone,
          `⚠️ *Ghar Ka Mali*\nYour gardener waited at your location for ${booking.booking_number} but couldn't start the visit. Please reschedule or contact support.`
        );
      }
      if (gardener) {
        await sendWhatsApp(
          gardener.phone,
          `ℹ️ *Ghar Ka Mali*\nBooking ${booking.booking_number} has been marked as failed as OTP was not verified within 45 minutes.`
        );
      }
    }
    if (stuck.length > 0) console.log(`[CRON] Marked ${stuck.length} visits as failed (customer unavailable)`);
  } catch (err) {
    console.error('[CRON] Failed visit mark error:', err.message);
  }
});

console.log('✅ All cron jobs initialized (6 scheduled tasks)');

// ── 7. SLA breach detection — every hour ─────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  try {
    const { SLABreach, SLAConfig, GardenerProfile } = require('../models');
    const config = await SLAConfig.findOne({ where: { is_active: true } }) || { max_arrival_delay_mins: 30 };
    const now = moment();

    // Breach type 1: Assigned bookings where scheduled time passed but still no en_route
    const lateStart = await Booking.findAll({
      where: {
        status: 'assigned',
        scheduled_date: { [Op.lte]: now.format('YYYY-MM-DD') },
      },
      include: [{ model: User, as: 'customer' }, { model: User, as: 'gardener' }]
    });

    for (const b of lateStart) {
      const scheduledAt = moment(`${b.scheduled_date} ${b.scheduled_time || '09:00:00'}`);
      const delayMins = now.diff(scheduledAt, 'minutes');

      if (delayMins > (config.max_arrival_delay_mins || 30)) {
        // Check not already logged
        const exists = await SLABreach.findOne({ where: { booking_id: b.id, breach_type: 'late_arrival', is_resolved: false } });
        if (!exists) {
          const breach = await SLABreach.create({
            booking_id: b.id, gardener_id: b.gardener_id,
            breach_type: 'late_arrival', expected_by: scheduledAt.toDate(),
            detected_at: new Date(), delay_minutes: delayMins
          });

          // Notify supervisor
          if (b.gardener_id) {
            const profile = await GardenerProfile.findOne({ where: { user_id: b.gardener_id } });
            if (profile?.supervisor_id) {
              const sup = await User.findByPk(profile.supervisor_id);
              if (sup) {
                await sendWhatsApp(sup.phone,
                  `🚨 *SLA Breach — Ghar Ka Mali*\nBooking ${b.booking_number} is ${delayMins} minutes late.\nGardener: ${b.gardener?.name || 'Unknown'}\nCustomer: ${b.customer?.name || 'Unknown'}\nPlease investigate immediately.`
                );
                await breach.update({ supervisor_notified: true });
              }
            }
          }
          console.log(`[SLA] Breach logged for booking ${b.booking_number}: ${delayMins} min late`);
        }
      }
    }

    // Breach type 2: in_progress bookings running over max duration
    const overtime = await Booking.findAll({
      where: { status: 'in_progress', started_at: { [Op.lt]: moment().subtract(config.max_service_duration_hrs || 3, 'hours').toDate() } },
      include: [{ model: User, as: 'customer' }, { model: User, as: 'gardener' }]
    });

    for (const b of overtime) {
      const exists = await SLABreach.findOne({ where: { booking_id: b.id, breach_type: 'service_overtime', is_resolved: false } });
      if (!exists) {
        const overMins = moment().diff(moment(b.started_at), 'minutes') - ((config.max_service_duration_hrs || 3) * 60);
        await SLABreach.create({
          booking_id: b.id, gardener_id: b.gardener_id,
          breach_type: 'service_overtime', detected_at: new Date(), delay_minutes: overMins
        });
        console.log(`[SLA] Service overtime for booking ${b.booking_number}: ${overMins} min over`);
      }
    }
  } catch (err) {
    console.error('[CRON] SLA check error:', err.message);
  }
});
