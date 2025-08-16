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

    // Try to send email, but don't fail if email config is missing
    try {
      await sendEmail(email, otpCode);
      res.status(200).json({ message: 'OTP sent to email' });
    } catch (emailError) {
      console.warn('Email sending failed, but OTP was saved:', emailError.message);
      // For development/testing, return the OTP in response if email fails
      if (process.env.NODE_ENV === 'development') {
        res.status(200).json({ 
          message: 'OTP saved (email not configured)', 
          otp: otpCode,
          note: 'This is for development only. Configure EMAIL_USER and EMAIL_PASS for production.'
        });
      } else {
        res.status(500).json({ message: 'Failed to send OTP email' });
      }
    }

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

    // Don't delete OTP here - we need it for password reset
    res.status(200).json({ message: 'OTP verified successfully' });

  } catch (err) {
    console.error('Verify OTP Error:', err);
    res.status(500).json({ message: 'OTP verification failed' });
  }
};

// Reset Password
exports.resetPassword = async (req, res) => {
  const { email, otp, currentPassword, newPassword } = req.body;

  try {
    // First verify the OTP again
    const otpRecord = await OTP.findOne({ email });
    
    if (!otpRecord) {
      return res.status(404).json({ message: 'OTP not found for this email' });
    }

    const isExpired = (new Date() - new Date(otpRecord.createdAt)) > 5 * 60 * 1000; // 5 mins
    if (isExpired) {
      return res.status(400).json({ message: 'OTP has expired' });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Find the user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password
    if (user.password !== currentPassword) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Clean up OTP
    await OTP.deleteOne({ email });

    res.status(200).json({ message: 'Password reset successfully' });

  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ message: 'Password reset failed' });
  }
};
