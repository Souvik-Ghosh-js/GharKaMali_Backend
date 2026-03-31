const { Product, ProductCategory, Order, OrderItem, Payment, sequelize } = require('../models');
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
    const { category, search, min_price, max_price } = req.query;
    const where = { is_active: true };

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

    const products = await Product.findAll({
      where,
      include: [{ model: ProductCategory, as: 'category', attributes: ['name', 'slug'] }],
      order: [['created_at', 'DESC']]
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
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CUSTOMER ORDER ENDPOINTS ───────────────────────────────────────────────

// Create order / Checkout
exports.createOrder = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { items, shipping_address, shipping_city, shipping_pincode, notes } = req.body;
    
    if (!items || !items.length) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    let totalAmount = 0;
    const orderItemsData = [];

    // Validate products and calculate total
    for (const item of items) {
      const product = await Product.findByPk(item.product_id);
      if (!product || !product.is_active) {
        throw new Error(`Product ${item.product_id} is no longer available`);
      }
      if (product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      const itemTotal = parseFloat(product.price) * item.quantity;
      totalAmount += itemTotal;

      orderItemsData.push({
        product_id: product.id,
        quantity: item.quantity,
        price: product.price
      });

      // Optional: Decrement stock
      await product.decrement('stock_quantity', { by: item.quantity, transaction: t });
    }

    const orderNumber = `GKM-ORD-${Date.now()}`;
    
    // Create Order
    const order = await Order.create({
      order_number: orderNumber,
      customer_id: req.user.id,
      total_amount: totalAmount,
      shipping_address,
      shipping_city,
      shipping_pincode,
      notes
    }, { transaction: t });

    // Create Order Items
    await OrderItem.bulkCreate(
      orderItemsData.map(item => ({ ...item, order_id: order.id })),
      { transaction: t }
    );

    await t.commit();

    // ── MOCK PAYMENT: Immediately mark order as paid ─────────────────────────
    const txnid = `GKM-TXN-${Date.now()}`;
    await Order.update(
      { status: 'processing', payment_status: 'paid', payment_id: txnid },
      { where: { id: order.id } }
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

    return res.json({
      success: true,
      message: 'Order placed successfully! Payment confirmed.',
      data: {
        order_number: order.order_number,
        order_id: order.id,
        total_amount: totalAmount,
        payment_status: 'paid',
        txnid
      }
    });

  } catch (err) {
    await t.rollback();
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
