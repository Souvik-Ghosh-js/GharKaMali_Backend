const express = require('express');
const router = express.Router();
const addressController = require('../controllers/address.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate); // All address routes require login

router.post('/', addressController.addAddress);
router.get('/', addressController.getMyAddresses);
router.delete('/:id', addressController.deleteAddress);
router.patch('/:id/default', addressController.setDefault);

module.exports = router;
