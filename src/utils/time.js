const moment = require('moment');

// The server process runs in UTC, but the business (and the Sequelize DB
// connection, configured with timezone '+05:30') runs in IST. Any wall-clock
// "now" / "today" derived from a bare moment() is therefore 5h30m behind real
// local time — which silently shifts instant-booking slots and "today"/"upcoming"
// date filters near midnight. Always derive business dates/times through these.
const IST_OFFSET_MINUTES = 330; // +05:30

// moment in IST — use for any wall-clock formatting/arithmetic.
const nowIST = () => moment().utcOffset(IST_OFFSET_MINUTES);

// Today's date in IST as 'YYYY-MM-DD' — use for scheduled_date comparisons.
const todayIST = () => nowIST().format('YYYY-MM-DD');

module.exports = { IST_OFFSET_MINUTES, nowIST, todayIST };
