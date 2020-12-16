const fs = require('fs')
module.exports = (p) => {
  try {
    const files = fs.readdirSync(p);
    return files
  } catch (e) {
    console.warn('appsync graphql schema is not built. please run yarn appsync:build if you are going to use the graphql feature')
    return []
  }
}
