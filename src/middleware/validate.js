// Generic validation helpers built on express-validator.
// Usage:
//   router.post('/x', validate(authRules.sendOtp), handler);
// On failure -> 400 { success:false, message, errors:[{field, message}] }
const { validationResult } = require('express-validator');

function runValidations(rules, req) {
  return Promise.all(rules.map(r => (typeof r.run === 'function' ? r.run(req) : Promise.resolve())));
}

// Factory: wraps an array of validation chains into Express middleware that
// runs them and returns a 400 with a clean error payload on failure.
const validate = (rules) => async (req, res, next) => {
  try {
    await runValidations(rules, req);
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    const formatted = errors.array({ onlyFirstError: true }).map(e => ({
      field: e.path || e.param,
      message: e.msg,
    }));
    return res.status(400).json({
      success: false,
      message: formatted[0]?.message || 'Validation failed',
      errors: formatted,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Validation error', detail: err.message });
  }
};

module.exports = { validate };
