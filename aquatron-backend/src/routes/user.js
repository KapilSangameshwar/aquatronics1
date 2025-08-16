const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getUsers, updateUser, deleteUser, createUser } = require('../controllers/userController');
const router = express.Router();

router.get('/', authenticate, authorize(['superadmin', 'admin']), getUsers);
router.post('/', authenticate, authorize(['superadmin', 'admin']), createUser);
router.put('/:id', authenticate, authorize(['superadmin']), updateUser);
router.delete('/:id', authenticate, authorize(['superadmin']), deleteUser);

module.exports = router;
