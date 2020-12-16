const path = require("path");
const fs = require("fs");
const YAML = require("yamljs");
const readFiles = require('./read-files')

const functions = (serverless) => {
  return Object.keys(serverless.service.functions).map((f) => ({
    type: "AWS_LAMBDA",
    name: f,
    config: {
      functionName: f,
    },
  }));
};


const databases = (serverless) => {
  const files = readFiles(path.join(__dirname, "./build/resources/dynamodb"));
  return files
    .filter((f) => /\.resource\.yml$/.test(f))
    .map((f) => fs.readFileSync(path.join(__dirname, "./build/resources/dynamodb", f), "utf8"))
    .map((raw) => YAML.parse(raw))
    .reduce((res, yml) => [...res, ...Object.keys(yml.Resources)], [])
    .map((def) => ({
      type: "AMAZON_DYNAMODB",
      name: def.replace(/Table$/, ""),
      config: {
        tableName: {
          Ref: def,
        },
        serviceRoleArn: {
          "Fn::GetAtt": ["AppSyncDynamoDBServiceRole", "Arn"],
        },
      },
    }));

};

module.exports = (serverless) => {
  const files = readFiles(path.join(__dirname, './build/resources/appsync'));

  const merged = files
    .filter((f) => /\.datasource\.yml$/.test(f))
    .map((f) => fs.readFileSync(path.join(__dirname, './build/resources/appsync', f), "utf8"))
    .map((raw) => YAML.parse(raw))
    .reduce((res, arr) => [...res, ...arr], []);

  return [...databases(serverless), ...functions(serverless), ...merged];
};
