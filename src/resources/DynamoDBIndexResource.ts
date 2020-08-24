import {
  IResource,
  ResourceDefinition,
} from "../interfaces/resource/IResource";

export type KeySpec = {
  name?: string;
  fields: [string, ...string[]];
  queryField?: string;
};

export class DynamoDBIndexResource implements IResource {
  constructor(private tableName: string, private keySpec: KeySpec) { }
  outputResourceDefinition(): ResourceDefinition[] {
    if (this.keySpec.name) {
      return [
        {
          location: `resources/dynamodb/${this.tableName}.resource.yml`,
          path: `Resources#${this.tableName}Table#GlobalSecondaryIndexes`,
          resource: [
            {
              IndexName: this.keySpec.name,
              KeySchema: buildKey(this.keySpec.fields),
              Projection: {
                ProjectionType: "ALL",
              },
              ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5,
              },
            },
          ],
        },
      ];
    }
    return [
      {
        location: `resources/dynamodb/${this.tableName}.resource.yml`,
        path: `Resources#${this.tableName}Table#Properties#AtttributeDefinitions`,
        resource: [
          {
            AttributeName: this.keySpec.fields[0],
            AttributeType: "S"
          }
        ],
      },
      {
        location: `resources/dynamodb/${this.tableName}.resource.yml`,
        path: `Resources#${this.tableName}Table#Properties#KeySchema`,
        resource: buildKey(this.keySpec.fields),
      },
    ]
  }
}

const buildKey = (fields: [string, ...string[]]) => {
  if (fields.length === 1) {
    return [
      {
        AttributeName: fields[0],
        KeyType: "HASH"
      },
    ]
  }
  return [
    {
      AttributeName: fields[0],
      KeyType: "HASH"
    },
    {
      AttributeName: fields.slice(1).join('#'),
      KeyType: "RANGE"
    }
  ]
}

// Resources:
//   Application:
//     Type: AWS::DynamoDB::Table
//     Properties:
//       TableName: ${self:custom.tableName}
//       AttributeDefinitions:
//         - AttributeName: partition_key
//           AttributeType: S
//         - AttributeName: sort_key
//           AttributeType: S
//         - AttributeName: gsi_key_1
//           AttributeType: S
//         - AttributeName: gsi_key_2
//           AttributeType: S
//       KeySchema:
//         - AttributeName: partition_key
//           KeyType: HASH
//         - AttributeName: sort_key
//           KeyType: RANGE