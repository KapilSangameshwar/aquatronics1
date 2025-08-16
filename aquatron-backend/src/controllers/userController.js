const User = require('../models/User');

exports.getUsers = async (req, res, next) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users);
  } catch (err) { next(err); }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true, select: '-password' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) { next(err); }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (err) { next(err); }
};

exports.createUser = async (req, res, next) => {
  try {
    const { username, email, password, role } = req.body;
    
    // Check if user already exists
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Role restrictions
    if (req.user.role === 'admin' && role === 'superadmin') {
      return res.status(403).json({ message: "Admins cannot create superadmin users" });
    }

    const user = new User({ username, email, password, role });
    await user.save();

    res.status(201).json({ message: "User created successfully", user: { username, email, role } });
  } catch (err) { 
    next(err); 
  }
};
