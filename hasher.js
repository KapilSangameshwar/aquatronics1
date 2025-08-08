const bcrypt = require('bcrypt');
bcrypt.hash('admin123', 10).then(console.log);
bcrypt.hash('user123', 10).then(console.log);
