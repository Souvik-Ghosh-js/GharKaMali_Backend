// One-off: set the admin's phone + password. Run on the server, then delete.
//   node set-admin.js
// Reads DB config from .env via the app's Sequelize instance.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { User, sequelize } = require('./src/models');

const NEW_PHONE = '7827705643';
const NEW_PASSWORD = 'gkmadmin@123';

(async () => {
  try {
    const hash = bcrypt.hashSync(NEW_PASSWORD, 10);
    const [count] = await User.update(
      { phone: NEW_PHONE, password: hash },
      { where: { role: 'admin' } }
    );
    console.log(`Updated ${count} admin row(s). New phone: ${NEW_PHONE}`);
    const admin = await User.findOne({ where: { role: 'admin' }, attributes: ['id', 'name', 'phone', 'role'] });
    console.log('Admin now:', JSON.stringify(admin, null, 2));
  } catch (e) {
    console.error('Failed:', e.message);
  } finally {
    await sequelize.close();
  }
})();
