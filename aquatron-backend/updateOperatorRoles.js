// Script to update existing users with 'operator' role to 'user' role
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function updateOperatorRoles() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find users with 'operator' role
    const operatorUsers = await User.find({ role: 'operator' });
    console.log(`🔍 Found ${operatorUsers.length} users with 'operator' role`);

    if (operatorUsers.length > 0) {
      // Update all operator users to user role
      const result = await User.updateMany(
        { role: 'operator' },
        { role: 'user' }
      );
      console.log(`✅ Updated ${result.modifiedCount} users from 'operator' to 'user' role`);
      
      // Show the updated users
      const updatedUsers = await User.find({ role: 'user' });
      console.log('📋 Users with updated roles:');
      updatedUsers.forEach(user => {
        console.log(`  - ${user.username} (${user.email}): ${user.role}`);
      });
    } else {
      console.log('ℹ️ No users with "operator" role found');
    }

    // Show all users and their roles
    const allUsers = await User.find({}, 'username email role');
    console.log('\n📊 All users and their roles:');
    allUsers.forEach(user => {
      console.log(`  - ${user.username} (${user.email}): ${user.role}`);
    });

  } catch (error) {
    console.error('❌ Error updating roles:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
updateOperatorRoles();
