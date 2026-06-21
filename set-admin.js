// One-off: set the admin's phone + password. Run on the server, then delete.
//   node set-admin.js
// Reads DB config from .env via the app's Sequelize instance.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { User, sequelize } = require('./src/models');

const NEW_PHONE = '7827705640';
const NEW_PASSWORD = 'gkmadmin@123';

(async () => {
  try {
    // Is the target number already taken by a DIFFERENT user? (phone is UNIQUE)
    const clash = await User.findOne({ where: { phone: NEW_PHONE }, attributes: ['id', 'name', 'phone', 'role'] });
    if (clash && clash.role !== 'admin') {
      console.error(`\n⚠️  Phone ${NEW_PHONE} is already used by another user:`);
      console.error(JSON.stringify(clash, null, 2));
      console.error('\nThat is why the update fails (phone must be unique).');
      console.error('Options: (a) pick a different admin number, or (b) free up this one — tell me which.');
      return;
    }

    const hash = bcrypt.hashSync(NEW_PASSWORD, 10);
    const [count] = await User.update(
      { phone: NEW_PHONE, password: hash },
      { where: { role: 'admin' } }
    );
    console.log(`Updated ${count} admin row(s). New phone: ${NEW_PHONE}`);
    const admin = await User.findOne({ where: { role: 'admin' }, attributes: ['id', 'name', 'phone', 'role'] });
    console.log('Admin now:', JSON.stringify(admin, null, 2));
  } catch (e) {
    // Print the FULL validation detail, not just the generic message.
    console.error('Failed:', e.message);
    if (e.errors) e.errors.forEach((er) => console.error(' -', er.path, ':', er.message, `(value: ${JSON.stringify(er.value)})`));
    console.error('Name:', e.name);
  } finally {
    await sequelize.close();
  }
})();
