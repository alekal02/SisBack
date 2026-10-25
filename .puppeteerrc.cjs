const { join } = require('path');

/** Cache do Chrome fica no projeto, para o build da Render levar o binário junto. */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
