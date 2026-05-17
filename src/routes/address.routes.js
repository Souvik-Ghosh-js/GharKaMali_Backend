const express = require('express');
const router = express.Router();
const addressController = require('../controllers/address.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const V = require('../middleware/validators');

router.use(authenticate); // All address routes require login

router.post('/', validate(V.address.create), addressController.addAddress);
router.get('/', addressController.getMyAddresses);
router.delete('/:id', addressController.deleteAddress);
router.patch('/:id/default', addressController.setDefault);

module.exports = router;
