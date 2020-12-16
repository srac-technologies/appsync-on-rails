const path = require('path')
const readFiles = require('./read-files')
module.exports = () => {
  return [
    ...readFiles(path.join(__dirname, './build/schema'))
      .filter((q) => /\.graphql$/.test(q))
      .map((d) => "./graphql/build/schema/" + d),
  ];
};
