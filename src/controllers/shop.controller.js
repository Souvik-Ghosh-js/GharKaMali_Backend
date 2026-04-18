const { Product, ProductCategory, Order, OrderItem, Payment, Geofence, User, sequelize } = require('../models');
const { Op } = require('sequelize');

// ─── PUBLIC SHOP ENDPOINTS ──────────────────────────────────────────────────

// List all categories
exports.getCategories = async (req, res) => {
  try {
    const categories = await ProductCategory.findAll({
      where: { is_active: true },
      order: [['name', 'ASC']]
    });
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// List products with filters
exports.getProducts = async (req, res) => {
  try {
    const { category, search, min_price, max_price, zone_id, geofence_id, limit = 20, page = 1 } = req.query;
    const where = { is_active: true };

    let productMarkup = 0;
    const activeZoneId = geofence_id || zone_id || (req.user ? (req.user.geofence_id || req.user.service_zone_id) : null);
    if (activeZoneId) {
      const zone = await Geofence.findByPk(activeZoneId);
      if (zone) productMarkup = parseFloat(zone.product_markup) || 0;
    }

    if (category) {
      const { Op: Op2 } = require('sequelize');
      const catObj = await ProductCategory.findOne({
        where: { [Op2.or]: [{ slug: category }, { name: category }] }
      });
      if (catObj) where.category_id = catObj.id;
      else where.category_id = -1; // No match → return empty
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { tags: { [Op.like]: `%${search}%` } }
      ];
    }

    if (min_price || max_price) {
      where.price = {};
      if (min_price) where.price[Op.gte] = parseFloat(min_price);
      if (max_price) where.price[Op.lte] = parseFloat(max_price);
    }

    const items = await Product.findAll({
      where,
      include: [{ model: ProductCategory, as: 'category', attributes: ['name', 'slug'] }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    // ── Location-based availability filter ────────────────────────────────────
    let filteredItems = items;
    const gfIdForFilter = geofence_id || (req.user ? req.user.geofence_id : null);
    if (gfIdForFilter) {
      const gfVal = Number(gfIdForFilter);
      filteredItems = items.filter(p => {
        const ids = p.available_geofence_ids;
        if (!ids || !Array.isArray(ids) || ids.length === 0) return true;
        return ids.map(Number).includes(gfVal);
      });
    }

    const products = filteredItems.map(p => {
      const json = p.toJSON();
      if (productMarkup > 0) {
        json.price = parseFloat(json.price) + productMarkup;
        json.mrp = json.mrp ? parseFloat(json.mrp) + productMarkup : null;
        json.location_markup = productMarkup;
      }
      return json;
    });

    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get product detail
exports.getProductDetail = async (req, res) => {
  try {
    const product = await Product.findOne({
      where: { id: req.params.id, is_active: true },
      include: [{ model: ProductCategory, as: 'category' }]
    });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    let json = product.toJSON();
    const { zone_id, geofence_id } = req.query;
    const activeZoneId = geofence_id || zone_id || (req.user ? (req.user.geofence_id || req.user.service_zone_id) : null);
    if (activeZoneId) {
      const zone = await Geofence.findByPk(activeZoneId);
      if (zone) {
        const productMarkup = parseFloat(zone.product_markup) || 0;
        if (productMarkup > 0) {
          json.price = parseFloat(json.price) + productMarkup;
          json.mrp = json.mrp ? parseFloat(json.mrp) + productMarkup : null;
          json.location_markup = productMarkup;
        }
      }
    }

    res.json({ success: true, data: json });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CUSTOMER ORDER ENDPOINTS ───────────────────────────────────────────────

// Create order / Checkout
exports.createOrder = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      items, shipping_address, shipping_city, shipping_pincode, notes, zone_id,
      geofence_id, service_latitude, service_longitude,
      // Book a Mali fields
      book_mali, service_address_for_mali, scheduled_date_for_mali, zone_id_for_mali,
      service_bookings
    } = req.body;
    
    if ((!items || !items.length) && (!service_bookings || !service_bookings.length)) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    let productMarkup = 0;
    const activeZoneId = geofence_id || zone_id || req.user.geofence_id || req.user.service_zone_id;
    if (activeZoneId) {
      const zone = await Geofence.findByPk(activeZoneId);
      if (zone) productMarkup = parseFloat(zone.product_markup) || 0;
    }

    let totalAmount = 0;
    const orderItemsData = [];

    // sum product items
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const product = await Product.findByPk(item.product_id);
        if (!product || !product.is_active) {
          throw new Error(`Product ${item.product_id} is no longer available`);
        }
        const finalPrice = parseFloat(product.price) + productMarkup;
        const itemTotal = finalPrice * item.quantity;
        totalAmount += itemTotal;
        orderItemsData.push({ product_id: product.id, quantity: item.quantity, price: finalPrice });
        await product.decrement('stock_quantity', { by: item.quantity, transaction: t });
      }
    }

    // sum service bookings
    if (service_bookings && Array.isArray(service_bookings)) {
      for (const service of service_bookings) {
        totalAmount += (parseFloat(service.price) || 0);
      }
    }

    const orderNumber = `GKM-ORD-${Date.now()}`;
    const txnid = `GKM-TXN-${Date.now()}`;
    
    // Create Order
    const order = await Order.create({
      order_number: orderNumber,
      customer_id: req.user.id,
      zone_id: activeZoneId,
      geofence_id: activeZoneId,
      total_amount: totalAmount,
      shipping_address,
      shipping_city,
      shipping_pincode,
      service_latitude: service_latitude || null,
      service_longitude: service_longitude || null,
      notes,
      status: 'processing',
      payment_status: 'paid',
      payment_id: txnid
    }, { transaction: t });

    // Create Order Items
    await OrderItem.bulkCreate(
      orderItemsData.map(item => ({ ...item, order_id: order.id })),
      { transaction: t }
    );

    // Create a payment audit record
    try {
      const { Payment } = require('../models');
      await Payment.create({
        txnid,
        user_id: req.user.id,
        amount: totalAmount,
        type: 'order',
        status: 'success',
        product_info: `Order-${order.order_number}`,
        gateway_response: { order_id: order.id, mock: true }
      });
    } catch (_) { /* Non-critical, ignore */ }

    // ── Book a Mali if requested ─────────────────────────────────────────────
    let maliBookingResults = [];
    if (book_mali) {
      try {
        const { Booking } = require('../models');
        
        // Handle new array-based service bookings from unified cart
        if (Array.isArray(service_bookings) && service_bookings.length > 0) {
          for (const service of service_bookings) {
            const bkgNumber = `GKM-BKG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
            
            const booking = await Booking.create({
              booking_number: bkgNumber,
              customer_id: req.user.id,
              zone_id: service.zone_id || zone_id_for_mali || null,
              geofence_id: service.geofence_id || geofence_id || zone_id_for_mali || null,
              booking_type: 'ondemand',
              status: 'pending',
              scheduled_date: service.scheduled_date || new Date().toISOString().split('T')[0],
              scheduled_time: service.scheduled_time || '09:00',
              otp: otpCode,
              service_address: service.service_address || shipping_address || '',
              service_latitude: service.service_latitude || 0,
              service_longitude: service.service_longitude || 0,
              plant_count: service.plant_count || 5,
              base_amount: service.price || 0,
              total_amount: service.price || 0,
              customer_notes: service.notes ? `${service.notes}\n(Via Order ${orderNumber})` : `Booked alongside shop order ${orderNumber}.`
            }, { transaction: t });
            
            maliBookingResults.push({
              booking_number: booking.booking_number,
              status: 'pending'
            });
          }
        } else {
          // Fallback to legacy single-booking logic
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const scheduledDate = scheduled_date_for_mali || tomorrow.toISOString().split('T')[0];
          const maliAddr = service_address_for_mali || shipping_address || '';
          const maliBooking = await Booking.create({
            booking_number: `GKM-BKG-${Date.now()}`,
            customer_id: req.user.id,
            zone_id: zone_id_for_mali || null,
            geofence_id: geofence_id || zone_id_for_mali || null,
            booking_type: 'ondemand',
            status: 'pending',
            scheduled_date: scheduledDate,
            service_address: maliAddr,
            service_latitude: 0,
            service_longitude: 0,
            otp: Math.floor(1000 + Math.random() * 9000).toString(),
            total_amount: 0,
            customer_notes: `Booked alongside shop order ${orderNumber}. Please contact customer to confirm visit details.`
          }, { transaction: t });
          
          maliBookingResults.push({
            booking_number: maliBooking.booking_number,
            status: 'pending'
          });
        }
      } catch (err) {
        console.error("Booking Creation Error in Order Controller:", err.message);
        throw err; // Re-throw to trigger rollback
      }
    }

    await t.commit();

    return res.json({
      success: true,
      message: book_mali
        ? 'Order placed & Mali booked! Our gardener will contact you soon.'
        : 'Order placed successfully! Payment confirmed.',
      data: {
        order_number: order.order_number,
        order_id: order.id,
        total_amount: totalAmount,
        payment_status: 'paid',
        txnid,
        mali_bookings: maliBookingResults
      }
    });

  } catch (err) {
    if (t && !t.finished) await t.rollback();
    console.error("Create Order Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get my orders
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { customer_id: req.user.id },
      include: [
        { 
          model: OrderItem, 
          as: 'items',
          include: [{ model: Product, as: 'product', attributes: ['name', 'icon_key'] }]
        }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
