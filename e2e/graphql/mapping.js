const path = require('path')
const readFiles = require('./read-files')
module.exports = () => {
  const fs = require("fs");
  const files = readFiles(path.join(__dirname, './build/resources/appsync'));
  const YAML = require("yamljs");

  const merged = files
    .filter((f) => /\.mapping\.yml$/.test(f))
    .map((f) => fs.readFileSync(path.join(__dirname, './build/resources/appsync', f), "utf8"))
    .map((raw) => YAML.parse(raw))
    .reduce((res, arr) => [...res, ...arr], []);

  return merged;
};

