const CommandHistory = require('../models/CommandHistory');

exports.getCommandHistory = async (req, res, next) => {
  try {
    const history = await CommandHistory.find().sort({ createdAt: -1 }).limit(100);
    res.json(history);
  } catch (err) { next(err); }
};
