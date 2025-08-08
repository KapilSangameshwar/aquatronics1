const express = require("express");
const { body } = require("express-validator");
const authController = require("../controllers/authController");
const otpController = require("../controllers/otpController");

const router = express.Router();

router.post(
  "/register",
  [
    body("username").isString().isLength({ min: 3 }),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
    body("role").isIn(["superadmin", "admin", "user"]),
  ],
  authController.register
);

router.post(
  "/login",
  [
    body("username").isString(),
    body("password").isString(),
  ],
  authController.login
);

router.post("/send-otp", otpController.sendOTP);
router.post("/verify-otp", otpController.verifyOTP);
// router.post("/reset-password", otpController.resetPassword); // Not implemented
// router.post("/test-email", otpController.testEmail); // Not implemented

module.exports = router;
