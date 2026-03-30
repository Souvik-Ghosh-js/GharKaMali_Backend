const axios = require('axios');
const { PlantIdentification, Blog, CityPage, User } = require('../models');
const { Op } = require('sequelize');

// ── PLANTOPEDIA ───────────────────────────────────────────────────────────────
exports.identifyPlant = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Please upload an image' });

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const imageUrl = `${baseUrl}/uploads/plants/${req.file.filename}`;

    let plantData = {
      plant_name: 'Unknown Plant',
      scientific_name: '',
      description: 'Plant identification service not configured. Please add Google Vision API key.',
      care_instructions: { watering: 'Water regularly', sunlight: 'Moderate sunlight', soil: 'Well-drained soil' },
      watering_schedule: 'Every 2-3 days',
      fertilizer_tips: 'Use general purpose fertilizer monthly',
      sunlight_requirement: 'Moderate',
      confidence_score: 0
    };

    // Call Google Vision / Plant.id API if key available
    if (process.env.PLANT_ID_API_KEY || process.env.GOOGLE_VISION_API_KEY) {
      const apiKey = process.env.PLANT_ID_API_KEY || process.env.GOOGLE_VISION_API_KEY;
      try {
        const fs = require('fs');
        const imageData = fs.readFileSync(req.file.path).toString('base64');
        const response = await axios.post('https://api.plant.id/v2/identify', {
          images: [imageData],
          plant_details: ['common_names', 'url', 'wiki_description', 'taxonomy', 'synonyms'],
          plant_language: 'en',
          disease_details: ['cause', 'description', 'treatment']
        }, { headers: { 'Api-Key': apiKey } });

        const result = response.data.suggestions[0];
        if (result) {
          plantData = {
            plant_name: result.plant_name || result.plant_details?.common_names?.[0] || 'Unknown',
            scientific_name: result.plant_name,
            description: result.plant_details?.wiki_description?.value?.substring(0, 500) || '',
            care_instructions: {
              watering: 'Water when top inch of soil is dry',
              sunlight: 'Bright indirect light',
              soil: 'Well-draining potting mix',
              humidity: 'Average household humidity',
              temperature: '65-75°F (18-24°C)'
            },
            watering_schedule: 'Every 2-3 days in summer, weekly in winter',
            fertilizer_tips: 'Feed with balanced liquid fertilizer monthly during growing season',
            sunlight_requirement: 'Bright indirect light',
            confidence_score: (result.probability * 100).toFixed(1),
            raw_response: response.data
          };
        }
      } catch (apiErr) {
        console.error('Plant ID API error:', apiErr.message);
      }
    }

    const record = await PlantIdentification.create({ user_id: req.user.id, image_url: imageUrl, ...plantData });
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMyPlantHistory = async (req, res) => {
  try {
    const history = await PlantIdentification.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: 20
    });
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: get all plant identification history ───────────────────────────────
exports.getAllPlantIdentifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { count, rows } = await PlantIdentification.findAndCountAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone'] }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit,
    });
    res.json({ success: true, data: { items: rows, total: count, page: parseInt(page) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── BLOGS ─────────────────────────────────────────────────────────────────────
exports.getBlogs = async (req, res) => {
  try {
    const { page = 1, limit = 10, category, city_slug } = req.query;
    const where = { status: 'published' };
    if (category) where.category = category;
    if (city_slug) where.city_slug = city_slug;
    const { count, rows } = await Blog.findAndCountAll({
      where,
      include: [{ model: User, as: 'author', attributes: ['name'] }],
      attributes: { exclude: ['content'] },
      order: [['published_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });
    res.json({ success: true, data: { blogs: rows, total: count, page: parseInt(page), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getBlogBySlug = async (req, res) => {
  try {
    const blog = await Blog.findOne({
      where: { slug: req.params.slug, status: 'published' },
      include: [{ model: User, as: 'author', attributes: ['name'] }]
    });
    if (!blog) return res.status(404).json({ success: false, message: 'Blog not found' });
    await blog.increment('views');
    res.json({ success: true, data: blog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createBlog = async (req, res) => {
  try {
    const { title, content, excerpt, category, tags, seo_title, seo_description, city_slug, status } = req.body;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const featured_image = req.file ? `${baseUrl}/uploads/blogs/${req.file.filename}` : null;

    const blog = await Blog.create({
      title, slug, content, excerpt, category,
      tags: tags ? JSON.parse(tags) : [],
      seo_title, seo_description, city_slug, status: status || 'draft',
      featured_image, author_id: req.user.id,
      published_at: status === 'published' ? new Date() : null
    });
    res.status(201).json({ success: true, data: blog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateBlog = async (req, res) => {
  try {
    const { status } = req.body;
    const updates = { ...req.body };
    if (status === 'published') updates.published_at = new Date();
    if (req.file) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      updates.featured_image = `${baseUrl}/uploads/blogs/${req.file.filename}`;
    }
    await Blog.update(updates, { where: { id: req.params.id } });
    const blog = await Blog.findByPk(req.params.id);
    res.json({ success: true, data: blog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteBlog = async (req, res) => {
  try {
    await Blog.update({ status: 'archived' }, { where: { id: req.params.id } });
    res.json({ success: true, message: 'Blog archived' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── CITY PAGES ────────────────────────────────────────────────────────────────
exports.getCityPages = async (req, res) => {
  try {
    const pages = await CityPage.findAll({ where: { is_active: true }, order: [['city_name', 'ASC']] });
    res.json({ success: true, data: pages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getCityPage = async (req, res) => {
  try {
    const page = await CityPage.findOne({ where: { slug: req.params.slug, is_active: true } });
    if (!page) return res.status(404).json({ success: false, message: 'City page not found' });
    res.json({ success: true, data: page });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.upsertCityPage = async (req, res) => {
  try {
    const { city_name } = req.body;
    const slug = city_name.toLowerCase().replace(/\s+/g, '-');
    const [page, created] = await CityPage.findOrCreate({
      where: { slug },
      defaults: { ...req.body, slug }
    });
    if (!created) await page.update(req.body);
    res.json({ success: true, data: page });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const { Notification } = require('../models');
    const notifs = await Notification.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: 30
    });
    res.json({ success: true, data: notifs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const { Notification } = require('../models');
    await Notification.update({ is_read: true, read_at: new Date() }, { where: { id: req.params.id, user_id: req.user.id } });
    res.json({ success: true, message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SUPERVISOR ────────────────────────────────────────────────────────────────
exports.getSupervisorDashboard = async (req, res) => {
  try {
    const { GardenerProfile } = require('../models');
    const myGardeners = await GardenerProfile.findAll({
      where: { supervisor_id: req.user.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone', 'is_active', 'city'] }]
    });
    const gardenerIds = myGardeners.map(g => g.user_id);
    const todayJobs = await Booking.count({ where: { gardener_id: { [Op.in]: gardenerIds }, scheduled_date: new Date().toISOString().split('T')[0] } });
    const completedToday = await Booking.count({ where: { gardener_id: { [Op.in]: gardenerIds }, status: 'completed', completed_at: { [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)) } } });

    res.json({ success: true, data: { myGardeners, stats: { todayJobs, completedToday, totalGardeners: myGardeners.length } } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
