const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getUsers, updateUser, deleteUser } = require('../controllers/userController');
const router = express.Router();

router.get('/', authenticate, authorize(['superadmin']), getUsers);
router.put('/:id', authenticate, authorize(['superadmin']), updateUser);
router.delete('/:id', authenticate, authorize(['superadmin']), deleteUser);

module.exports = router;
