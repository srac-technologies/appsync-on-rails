const path = require('path')
const readFiles = require('./read-files')
module.exports = () => {
  const fs = require("fs");
  const files = readFiles(path.join(__dirname, 'build/resources/dynamodb'));
  const YAML = require("yamljs");

  const merged = files
    .filter((f) => /\.resource\.yml$/.test(f))
    .map((f) => fs.readFileSync(path.join(__dirname, './build/resources/dynamodb', f), "utf8"))
    .map((raw) => YAML.parse(raw))
    .reduce(
      (res, obj) => ({ Resources: { ...res.Resources, ...obj.Resources } }),
      { Resources: {} }
    );

  return merged;
};
