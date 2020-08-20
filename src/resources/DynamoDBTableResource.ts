import {
  IResource,
  ResourceDefinition,
} from "../interfaces/resource/IResource";

export class DynamoDBTableResource implements IResource {
  constructor(private tableName: string) {}
  outputResourceDefinition(): ResourceDefinition[] {
    return [
      {
        location: `resources/dynamodb/${this.tableName}.resource.yml`,
        path: "",
        resource: {
          Resources: {
            [this.tableName + "Table"]: {
              Type: "AWS::DynamoDB::Table",
              Properties: {
                TableName: this.tableName,
                AttributeDefinitions: [
                  {
                    AttributeName: "id",
                    AttributeType: "S",
                  },
                ],
                KeySchema: [
                  {
                    AttributeName: "id",
                    KeyType: "HASH",
                  },
                ],
                ProvisionedThroughput: {
                  ReadCapacityUnits: 5,
                  WriteCapacityUnits: 5,
                },
              },
            },
          },
        },
      },
    ];
  }
}
