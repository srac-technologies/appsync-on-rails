import {
  IResource,
  ResourceDefinition,
} from "../interfaces/resource/IResource";

export type KeySpec = {
  name: string;
  fields: [string, string?];
};

export class DynamoDBIndexResource implements IResource {
  constructor(private tableName: string, private keySpec: KeySpec) {}
  outputResourceDefinition(): ResourceDefinition[] {
    return [
      {
        location: `resources/dynamodb/${this.tableName}.resource.yml`,
        path: `Resources#${this.tableName}Table#GlobalSecondaryIndexes`,
        resource: [
          {
            IndexName: this.keySpec.name,
            KeySchema: this.keySpec.fields.map((f, i) => ({
              AttributeName: f,
              KeyType: i === 0 ? "HASH" : "RANGE",
            })),
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
}
