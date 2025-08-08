const User = require('../models/User');
// const bcrypt = require('bcrypt'); // Commented out since we’re not using it
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

exports.register = async (req, res) => {
  let { username, email, password, role } = req.body;
  role = role || 'user'; // Default role

  try {
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = password; // No hashing
    const user = new User({ username, email, password: hashedPassword, role });
    await user.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ message: "Registration failed", error: err.message });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    // Compare raw passwords directly
    if (password !== user.password) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
  { id: user._id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: "1d" }
);


    res.status(200).json({ token });
  } catch (err) {
    res.status(500).json({ message: "Login failed", error: err.message });
  }
};
