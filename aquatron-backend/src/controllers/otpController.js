const OTP = require('../models/OTP');
const User = require('../models/User');
const nodemailer = require('nodemailer');

// Util to send OTP via email
const sendEmail = async (email, otp) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // Set in .env
      pass: process.env.EMAIL_PASS, // Set in .env
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your OTP Code',
    text: `Your OTP is: ${otp}`,
  };

  await transporter.sendMail(mailOptions);
};

// Send OTP
exports.sendOTP = async (req, res) => {
  const { email } = req.body;

  try {
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Save or update OTP
    const otp = await OTP.findOneAndUpdate(
      { email },
      { otp: otpCode, createdAt: new Date() },
      { upsert: true, new: true }
    );

    await sendEmail(email, otpCode);
    res.status(200).json({ message: 'OTP sent to email' });

  } catch (err) {
    console.error('Send OTP Error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
};

// Verify OTP
exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  try {
    const record = await OTP.findOne({ email });

    if (!record) {
      return res.status(404).json({ message: 'OTP not found for this email' });
    }

    const isExpired = (new Date() - new Date(record.createdAt)) > 5 * 60 * 1000; // 5 mins
    if (isExpired) {
      return res.status(400).json({ message: 'OTP has expired' });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Optional: Set user as verified if needed
    await OTP.deleteOne({ email }); // Clean up used OTP
    res.status(200).json({ message: 'OTP verified successfully' });

  } catch (err) {
    console.error('Verify OTP Error:', err);
    res.status(500).json({ message: 'OTP verification failed' });
  }
};
