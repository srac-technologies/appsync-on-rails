import {
  DocumentNode,
  FieldDefinitionNode,
  InputValueDefinitionNode,
  Kind,
  ObjectTypeDefinitionNode,
  print,
} from "graphql";
import { Printable } from "../interfaces/resource/Printable";
import { args } from "../io/CliArgs";
import { DiggerUtils, unTypeEasy, typeEasy } from "../utils/DiggerUtils";
import { ResourceDefinition } from "../interfaces/resource/IResource";

export type KeySpec = {
  name?: string;
  fields: [string, ...string[]];
  queryField?: string;
};
export type ConnectionSpec = {
  with: string;
  hasMany: boolean;
  name: string;
  foreignKey?: string;
  node: FieldDefinitionNode;
};

export class TableResource implements Printable {
  get primaryKey() {
    return this.keys.find((k) => !k.name) || { fields: ["id"] };
  }

  static table(tableName: string) {
    return this.instances.find((i) => i.tableName === tableName);
  }

  private keys: KeySpec[] = [];
  static instances: TableResource[] = [];
  connections: ConnectionSpec[] = [];

  hasMany_: ConnectionSpec[] = [];
  hasOne_: ConnectionSpec[] = [];
  belongsTo_: ConnectionSpec[] = [];

  constructor(
    private tableName: string,
    private provider: "DYNAMODB" | "AURORA_MYSQL",
    private typeNode: ObjectTypeDefinitionNode
  ) {
    TableResource.instances.push(this);
  }

  hasMany(connection: ConnectionSpec) {
    this.hasMany_.push(connection);
  }
  hasOne(connection: ConnectionSpec) {
    this.hasOne_.push(connection);
  }
  belongsTo(connection: ConnectionSpec) {
    this.belongsTo_.push(connection);
  }
  hasConnection(connection: ConnectionSpec) {
    this.connections.push(connection);
    if (!connection.hasMany) {
      if (
        TableResource.instances
          .find((i) => i.tableName === connection.with)
          ?.connections.find((c) => c.name === connection.name)?.hasMany
      ) {
        this.belongsTo(connection);
        return;
      }
      this.hasOne(connection);
      return;
    }
    this.hasMany(connection);
    return;
  }

  addKey(key: KeySpec) {
    this.keys.push(key);
  }

  print() {
    console.log(this);
    return [...this.printPersistanceLayer(), ...this.printGraphqlLayer()];
  }

  printPersistanceLayer() {
    switch (this.provider) {
      case "DYNAMODB":
        return [
          {
            location: `resources/dynamodb/${this.tableName}.resource.yml`,
            path: "",
            resource: {
              Resources: {
                [this.tableName + "Table"]: buildGSIs(
                  this.keys,
                  this.belongsTo_,
                  {
                    Type: "AWS::DynamoDB::Table",
                    Properties: {
                      TableName: this.tableName,
                      AttributeDefinitions: [
                        ...buildPrimaryKeys(this.primaryKey).map((k) => ({
                          AttributeName: k,
                          AttributeType: "S",
                        })),
                      ],
                      StreamSpecification: {
                        StreamViewType: "NEW_AND_OLD_IMAGES",
                      },
                      KeySchema: [
                        ...buildKey(
                          this.keys.find((k) => !k.name)?.fields || ["id"]
                        ),
                      ],
                      ProvisionedThroughput: {
                        ReadCapacityUnits: 5,
                        WriteCapacityUnits: 5,
                      },
                    },
                  },
                  this.tableName
                ),
              },
            },
          },
        ];
    }
    return [];
  }

  printGraphqlLayer(): ResourceDefinition[] {
    return [
      {
        location: `resources/appsync/${this.tableName}.mapping.yml`,
        path: "",
        resource: [
          {
            dataSource: this.tableName,
            type: "Query",
            field: `get${this.tableName}`,
          },
          {
            dataSource: this.tableName,
            type: "Query",
            field: `list${this.tableName}s`,
          },
          {
            dataSource: this.tableName,
            type: "Mutation",
            field: `create${this.tableName}`,
          },
          {
            dataSource: this.tableName,
            type: "Mutation",
            field: `update${this.tableName}`,
          },
          {
            dataSource: this.tableName,
            type: "Mutation",
            field: `delete${this.tableName}`,
          },
        ],
      },
      {
        location: `mapping-templates/Query.get${this.tableName}.request.vtl`,
        path: "",
        resource: buildGetReq(this.primaryKey),
      },
      {
        location: `mapping-templates/Query.list${this.tableName}s.request.vtl`,
        path: "",
        resource: buildListReq(),
      },
      {
        location: `mapping-templates/Mutation.create${this.tableName}.request.vtl`,
        path: "",
        resource: buildCreateReq(
          this.tableName,
          this.primaryKey,
          this.keys.filter((k) => k.fields.length > 2)
        ),
      },
      {
        location: `mapping-templates/Mutation.update${this.tableName}.request.vtl`,
        path: "",
        resource: buildUpdateReq(this.tableName, this.primaryKey),
      },
      {
        location: `mapping-templates/Mutation.delete${this.tableName}.request.vtl`,
        path: "",
        resource: buildDeleteReq(this.tableName, this.primaryKey),
      },
      {
        location: `mapping-templates/Query.get${this.tableName}.response.vtl`,
        path: "",
        resource: buildGetRes(),
      },
      {
        location: `mapping-templates/Query.list${this.tableName}s.response.vtl`,
        path: "",
        resource: buildListRes(),
      },
      {
        location: `mapping-templates/Mutation.create${this.tableName}.response.vtl`,
        path: "",
        resource: buildCreateRes(),
      },
      {
        location: `mapping-templates/Mutation.update${this.tableName}.response.vtl`,
        path: "",
        resource: buildUpdateRes(),
      },
      {
        location: `mapping-templates/Mutation.delete${this.tableName}.response.vtl`,
        path: "",
        resource: buildDeleteRes(),
      },
      {
        location: `schema/${this.tableName}.graphql`,
        path: "",
        resource: buildCrudOperations(
          this.tableName,
          this.primaryKey,
          this.typeNode,
          this.keys.filter((k) => k.name),
          this.connections
        ),
      },
      {
        location: `schema/${args["in-schema"]}`,
        path: DiggerUtils.removeObjectDirective(this.tableName, "model"),
        resource: {},
      },
      {
        location: `schema/${args["in-schema"]}`,
        path: DiggerUtils.removeObjectDirective(this.tableName, "key"),
        resource: {},
      },
      ...this.connections.map((c) => ({
        location: `resources/appsync/${this.tableName}.${c.node.name.value}.mapping.yml`,
        path: "",
        resource: [
          {
            dataSource: c.with,
            type: this.tableName,
            field: c.node.name.value,
          },
        ],
      })),
      ...this.connections.map((c) => ({
        location: `schema/${args["in-schema"]}`,
        path: DiggerUtils.removeFieldDirective(
          this.tableName,
          c.node.name.value,
          "connection"
        ),
        resource: {},
      })),
      ...this.connections.map((c) => ({
        location: `mapping-templates/${this.tableName}.${c.node.name.value}.request.vtl`,
        path: "",
        resource: c.hasMany
          ? buildHasMany(
              TableResource.table(c.with)?.primaryKey.fields[0] || "",
              getForeignKey(c, this.tableName),
              c.name
            )[0]
          : buildHasOne(
              TableResource.table(c.with)?.primaryKey.fields[0] || "",
              getForeignKey(c, this.tableName)
            )[0],
      })),
      ...this.connections.map((c) => ({
        location: `mapping-templates/${this.tableName}.${c.node.name.value}.response.vtl`,
        path: "",
        resource: c.hasMany
          ? buildHasMany(
              TableResource.table(c.with)?.primaryKey.fields[0] || "",
              getForeignKey(c, this.tableName),
              c.name
            )[1]
          : buildHasOne(
              TableResource.table(c.with)?.primaryKey.fields[0] || "",
              getForeignKey(c, this.tableName)
            )[1],
      })),
      ...this.connections.map((c) => ({
        location: `schema/${args["in-schema"]}`,
        path: DiggerUtils.updateField(
          this.tableName,
          c.node.name.value,
          (f) => ({
            ...f,
            type: (() => {
              const type = unTypeEasy(c.node);
              if (type.list) {
                return typeEasy({
                  list: false,
                  required: type.required,
                  baseTypeName: `Model${type.baseTypeName}Connection`,
                });
              }
              return c.node.type;
            })(),
            arguments: c.hasMany
              ? [
                  {
                    kind: "InputValueDefinition",
                    name: { value: "filter", kind: "Name" },
                    type: {
                      kind: "NamedType",
                      name: {
                        value: `Model${
                          unTypeEasy(c.node).baseTypeName
                        }FilterInput`,
                        kind: "Name",
                      },
                    },
                  },
                  {
                    kind: "InputValueDefinition",
                    name: { value: "sortDirection", kind: "Name" },
                    type: {
                      kind: "NamedType",
                      name: {
                        value: "ModelSortDirection",
                        kind: "Name",
                      },
                    },
                  },
                  {
                    kind: "InputValueDefinition",
                    name: { value: "limit", kind: "Name" },
                    type: {
                      kind: "NamedType",
                      name: {
                        value: "Int",
                        kind: "Name",
                      },
                    },
                  },
                  {
                    kind: "InputValueDefinition",
                    name: { value: "nextToken", kind: "Name" },
                    type: {
                      kind: "NamedType",
                      name: {
                        value: "String",
                        kind: "Name",
                      },
                    },
                  },
                ]
              : [],
          })
        ),
        resource: {},
      })),
      ...this.keys
        .filter((k) => k.name)
        .map((k) => [
          {
            location: `resources/appsync/${this.tableName}.${k.queryField}.mapping.yml`,
            path: "",
            resource: [
              {
                dataSource: this.tableName,
                type: "Query",
                field: k.queryField,
              },
            ],
          },
          {
            location: `mapping-templates/Query.${k.queryField}.request.vtl`,
            path: "",
            resource: buildQueryListReq(k),
          },
          {
            location: `mapping-templates/Query.${k.queryField}.response.vtl`,
            path: "",
            resource: buildListRes(),
          },
          {
            location: `schema/${this.tableName}.${k.queryField}.graphql`,
            path: "",
            resource: buildQueryOperations(this.tableName, k),
          },
        ])
        .reduce((res, elem) => [...res, ...elem], []),
    ];
  }
}

const getForeignKey = (connection: ConnectionSpec, tableName: string) => {
  return (
    connection.foreignKey ||
    `${tableName[0].toLowerCase() + tableName.slice(1)}${connection.with}Id`
  );
};

const buildGSIs = (
  keys: KeySpec[],
  belongsTos: ConnectionSpec[],
  origin: any,
  self: string
): any => {
  if (keys.length === 0 && belongsTos.length === 0) {
    return origin;
  }

  if (belongsTos.length === 0 && keys.every((k) => !k.name)) {
    return origin;
  }

  return {
    ...origin,
    Properties: {
      ...origin.Properties,
      AttributeDefinitions: [
        ...origin.Properties.AttributeDefinitions,
        ...[
          ...keys
            .filter((k) => k.name)
            .map((k) => buildPrimaryKeys(k))
            .reduce((res, elem) => [...res, ...elem], []),
          ...belongsTos.map((b) => getForeignKey(b, self)),
        ].map((k) => ({
          AttributeName: k,
          AttributeType: "S",
        })),
      ],
      GlobalSecondaryIndexes: [
        ...keys
          .filter((k) => k.name)
          .map((k) => ({
            IndexName: k.name,
            KeySchema: buildKey(k.fields),
            Projection: {
              ProjectionType: "ALL",
            },
            ProvisionedThroughput: {
              ReadCapacityUnits: 5,
              WriteCapacityUnits: 5,
            },
          })),
        ...belongsTos.map((b) => ({
          IndexName: b.name,
          KeySchema: [
            {
              AttributeName:
                b.foreignKey ||
                `${self[0].toLowerCase() + self.slice(1)}${b.with}Id`,
              KeyType: "HASH",
            },
          ],
          Projection: {
            ProjectionType: "ALL",
          },
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5,
          },
        })),
      ],
    },
  };
};

const buildKey = (fields: [string, ...string[]]) => {
  if (fields.length === 1) {
    return [
      {
        AttributeName: fields[0],
        KeyType: "HASH",
      },
    ];
  }
  return [
    {
      AttributeName: fields[0],
      KeyType: "HASH",
    },
    {
      AttributeName: fields.slice(1).join("#"),
      KeyType: "RANGE",
    },
  ];
};
const makeTypeModelInput = (
  tableName: string,
  f: FieldDefinitionNode,
  connections: ConnectionSpec[]
): InputValueDefinitionNode => {
  const connection = connections.find(
    (c) => c.node.name.value === f.name.value
  );
  if (connection) {
    return {
      ...f,
      name: {
        kind: "Name",
        value: getForeignKey(connection, tableName),
      },
      type: {
        kind: "NamedType",
        name: {
          kind: "Name",
          value: `ModelStringInput`,
        },
      },
      kind: "InputValueDefinition",
      directives: (f.directives || []).filter(
        (d) => d.name.value !== "connection"
      ),
    };
  }

  switch (f.type.kind) {
    case "ListType":
      return {
        ...f,
        kind: "InputValueDefinition",
      };
    case "NamedType":
    default:
      return {
        ...f,
        type: {
          kind: "NamedType",
          name: { kind: "Name", value: `Model${f.type.name.value}Input` },
        },
        kind: "InputValueDefinition",
      };
    case "NonNullType":
      switch (f.type.type.kind) {
        case "ListType":
          return {
            ...f,
            kind: "InputValueDefinition",
          };
        case "NamedType":
          return {
            ...f,
            kind: "InputValueDefinition",
            type: {
              kind: "NamedType",
              name: {
                kind: "Name",
                value: `Model${f.type.type.name.value}Input`,
              },
            },
          };
      }
  }
};

const buildPrimaryKeys = (spec: KeySpec) => {
  return [spec.fields[0], spec.fields.slice(1).join("#")].filter((a) => !!a);
};
const buildSafePrimaryKeys = (spec: KeySpec) => {
  if (spec.fields.length <= 1) {
    return [spec.fields[0]];
  }

  return [
    spec.fields[0],
    spec.fields[1] +
      spec.fields
        .slice(2)
        .map((f) => f[0].toUpperCase() + f.slice(1))
        .join(""),
  ].filter((a) => !!a);
};

const buildSortKeyQueryOperations = (typeName: string, keySpecs: KeySpec[]) => {
  return keySpecs.map((keySpec) => ({
    query: `
  ${keySpec.queryField}(${(() => {
      if (keySpec.fields.length === 1) {
        return `${keySpec.fields[0]}: String`;
      }
      if (keySpec.fields.length === 2) {
        return `${keySpec.fields[0]}: String,  ${keySpec.fields[1]}: ModelStringConditionInput`;
      }
      return `${keySpec.fields[0]}: String,  ${
        keySpec.fields[1]
      }${keySpec.fields
        .slice(2)
        .map((f) => f[0].toUpperCase() + f.slice(1))
        .join("")}: Model${typeName}${keySpec.name}CompositeKeyConditionInput`;
    })()}, sortDirection:ModelSortDirection, filter: Model${typeName}FilterInput, limit: Int, nextToken: String): Model${typeName}Connection 
 `,
    inputs: `
input Model${typeName}${keySpec.name}CompositeKeyConditionInput {
  eq: Model${typeName}${keySpec.name}CompositeKeyInput
  le: Model${typeName}${keySpec.name}CompositeKeyInput
  lt: Model${typeName}${keySpec.name}CompositeKeyInput
  ge: Model${typeName}${keySpec.name}CompositeKeyInput
  gt: Model${typeName}${keySpec.name}CompositeKeyInput
  between: [Model${typeName}${keySpec.name}CompositeKeyInput]
  beginsWith: Model${typeName}${keySpec.name}CompositeKeyInput
}

input Model${typeName}${keySpec.name}CompositeKeyInput {
  ${keySpec.fields
    .slice(1)
    .map((f) => `${f}: String`)
    .join("\n")}
}
`,
  }));
};

const buildCrudOperations = (
  typeName: string,
  primaryKey: KeySpec,
  typeNode: ObjectTypeDefinitionNode,
  sortKeys: KeySpec[],
  connections: ConnectionSpec[]
) => {
  const keyOperations = buildSortKeyQueryOperations(typeName, sortKeys);
  return `
 extend type Query {
  get${typeName}(${buildSafePrimaryKeys(primaryKey)
    .map((k) => `${k}: ID!`)
    .join(",")}): ${typeName} 
  list${typeName}s(filter: Model${typeName}FilterInput, limit: Int, nextToken: String): Model${typeName}Connection 
  ${keyOperations.map((o) => o.query).join("\n")}
 }
 extend type Mutation {
  create${typeName}(input: Create${typeName}Input!, condition: Model${typeName}ConditionInput): ${typeName}
  update${typeName}(input: Update${typeName}Input!, condition: Model${typeName}ConditionInput): ${typeName}
  delete${typeName}(input: Delete${typeName}Input!, condition: Model${typeName}ConditionInput): ${typeName}
 }
 type Model${typeName}Connection {
   items: [${typeName}]
   nextToken: String
 }
 ${print({
   kind: "InputObjectTypeDefinition",
   name: {
     kind: "Name",
     value: `Model${typeName}ConditionInput`,
   },
   fields: [
     ...(typeNode.fields || [])
       .filter(
         (f) =>
           !connections.some(
             (c) => c.node.name.value === f.name.value && c.hasMany
           )
       )
       .map((f) => makeTypeModelInput(typeName, f, connections)),
     {
       kind: Kind.INPUT_VALUE_DEFINITION,
       name: { kind: "Name", value: "and" },
       type: {
         kind: "ListType",
         type: {
           kind: "NamedType",
           name: { kind: "Name", value: `Model${typeName}ConditionInput` },
         },
       },
     },
     {
       kind: Kind.INPUT_VALUE_DEFINITION,
       name: { kind: "Name", value: "or" },
       type: {
         kind: "ListType",
         type: {
           kind: "NamedType",
           name: { kind: "Name", value: `Model${typeName}ConditionInput` },
         },
       },
     },
     {
       kind: Kind.INPUT_VALUE_DEFINITION,
       name: {
         kind: "Name",
         value: "not",
       },
       type: {
         kind: "NamedType",
         name: { kind: "Name", value: `Model${typeName}ConditionInput` },
       },
     },
   ],
 })}
 ${print({
   kind: "InputObjectTypeDefinition",
   name: {
     kind: "Name",
     value: `Model${typeName}FilterInput`,
   },
   fields: [
     ...(typeNode.fields || [])
       .filter(
         (f) =>
           !connections.some(
             (c) => c.node.name.value === f.name.value && c.hasMany
           )
       )

       .map((f) => makeTypeModelInput(typeName, f, connections)),
     {
       kind: Kind.INPUT_VALUE_DEFINITION,
       name: { kind: "Name", value: "and" },
       type: {
         kind: "ListType",
         type: {
           kind: "NamedType",
           name: { kind: "Name", value: `Model${typeName}FilterInput` },
         },
       },
     },
     {
       kind: Kind.INPUT_VALUE_DEFINITION,
       name: { kind: "Name", value: "or" },
       type: {
         kind: "ListType",
         type: {
           kind: "NamedType",
           name: { kind: "Name", value: `Model${typeName}FilterInput` },
         },
       },
     },
     {
       kind: Kind.INPUT_VALUE_DEFINITION,
       name: {
         kind: "Name",
         value: "not",
       },
       type: {
         kind: "NamedType",
         name: { kind: "Name", value: `Model${typeName}FilterInput` },
       },
     },
   ],
 })}
 ${print({
   kind: "InputObjectTypeDefinition",
   name: {
     kind: "Name",
     value: `Create${typeName}Input`,
   },
   fields: typeNode.fields
     ?.filter(
       (f) =>
         !connections.some(
           (c) => c.node.name.value === f.name.value && c.hasMany
         )
     )
     .map((f) => {
       const connection = connections.find(
         (c) => c.node.name.value === f.name.value
       );
       return connection
         ? {
             ...f,
             name: {
               kind: "Name",
               value: getForeignKey(connection, typeName),
             },
             type:
               f.type.kind === "NonNullType"
                 ? {
                     kind: "NonNullType",
                     type: {
                       kind: "NamedType",
                       name: {
                         kind: "Name",
                         value: "String",
                       },
                     },
                   }
                 : {
                     kind: "NamedType",
                     name: {
                       kind: "Name",
                       value: "String",
                     },
                   },
             kind: "InputValueDefinition",
             directives: (f.directives || []).filter(
               (d) => d.name.value !== "connection"
             ),
           }
         : {
             ...f,
             type:
               f.type.kind === "NonNullType" &&
               f.type.type.kind === "NamedType" &&
               f.type.type.name.value === "ID"
                 ? {
                     kind: "NamedType",
                     name: {
                       kind: "Name",
                       value: "ID",
                     },
                   }
                 : f.type,
             kind: "InputValueDefinition",
             directives: (f.directives || []).filter(
               (d) => d.name.value !== "connection"
             ),
           };
     }),
 })}
 ${print({
   kind: "InputObjectTypeDefinition",
   name: {
     kind: "Name",
     value: `Update${typeName}Input`,
   },
   fields: typeNode.fields
     ?.filter(
       (f) =>
         !connections.some(
           (c) => c.node.name.value === f.name.value && c.hasMany
         )
     )
     .map((f) => {
       const connection = connections.find(
         (c) => c.node.name.value === f.name.value
       );
       return connection
         ? {
             ...f,
             name: {
               kind: "Name",
               value: getForeignKey(connection, typeName),
             },
             type:
               f.type.kind === "NonNullType"
                 ? {
                     kind: "NonNullType",
                     type: {
                       kind: "NamedType",
                       name: {
                         kind: "Name",
                         value: "String",
                       },
                     },
                   }
                 : {
                     kind: "NamedType",
                     name: {
                       kind: "Name",
                       value: "String",
                     },
                   },
             kind: "InputValueDefinition",
             directives: (f.directives || []).filter(
               (d) => d.name.value !== "connection"
             ),
           }
         : {
             ...f,
             kind: "InputValueDefinition",
             directives: (f.directives || []).filter(
               (d) => d.name.value !== "connection"
             ),
           };
     }),
 })}
 input Delete${typeName}Input {
    ${buildSafePrimaryKeys(primaryKey)
      .map((pk) => `${pk}: ID!`)
      .join("\n")}
 }
 ${keyOperations.map((o) => o.inputs).join("\n")}
 `;
};

const buildGetReq = (primaryKey: KeySpec) => {
  return `
{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": #if( $modelObjectKey ) $util.toJson($modelObjectKey) #else {
  ${primaryKey.fields
    .map((f) => `"${f}": $util.dynamodb.toDynamoDBJson($ctx.args.${f})`)
    .join(",")}
} #end
}
  `;
};

const buildGetRes = () => {
  return `
$util.toJson($ctx.result)
  `;
};

const buildListReq = () => {
  return `
  #set( $limit = $util.defaultIfNull($context.args.limit, 100) )
#set( $ListRequest = {
  "version": "2017-02-28",
  "limit": $limit
} )
#if( $context.args.nextToken )
  #set( $ListRequest.nextToken = $context.args.nextToken )
#end
#if( $context.args.filter )
  #set( $ListRequest.filter = $util.parseJson("$util.transform.toDynamoDBFilterExpression($ctx.args.filter)") )
#end
#if( !$util.isNull($modelQueryExpression)
                        && !$util.isNullOrEmpty($modelQueryExpression.expression) )
  $util.qr($ListRequest.put("operation", "Query"))
  $util.qr($ListRequest.put("query", $modelQueryExpression))
  #if( !$util.isNull($ctx.args.sortDirection) && $ctx.args.sortDirection == "DESC" )
    #set( $ListRequest.scanIndexForward = false )
  #else
    #set( $ListRequest.scanIndexForward = true )
  #end
#else
  $util.qr($ListRequest.put("operation", "Scan"))
#end
$util.toJson($ListRequest)
  
  `;
};

const buildListRes = () => {
  return `
$util.toJson($ctx.result)
  `;
};

const buildCreateReq = (
  tableName: string,
  primaryKey: KeySpec,
  compositeKeys: KeySpec[]
) => {
  const keys = [
    primaryKey.fields[0],
    primaryKey.fields.slice(1).join("#"),
  ].filter((a) => !!a);
  return `
${
  (keys.length === 2 &&
    `
 ## [Start] Set the primary @key. **
#set( $modelObjectKey = {
  "${keys[0]}": $util.dynamodb.toDynamoDB($ctx.args.input.${keys[0]}),
  "${keys[1]}": $util.dynamodb.toDynamoDB("${primaryKey.fields
      .slice(1)
      .map((k) => `\${ctx.args.input.${k}}`)
      .join("#")}")
} )
## [End] Set the primary @key. ** 
`) ||
  ""
}
## [Start] Prepare DynamoDB PutItem Request. **
#set( $createdAt = $util.time.nowISO8601() )
## Automatically set the createdAt timestamp. **
$util.qr($context.args.input.put("createdAt", $util.defaultIfNull($ctx.args.input.createdAt, $createdAt)))
## Automatically set the updatedAt timestamp. **
$util.qr($context.args.input.put("updatedAt", $util.defaultIfNull($ctx.args.input.updatedAt, $createdAt)))
$util.qr($context.args.input.put("__typename", "${tableName}"))
${compositeKeys
  .map(
    (k) => `
$util.qr($ctx.args.input.put("${k.fields.slice(1).join("#")}","${k.fields
      .slice(1)
      .map((k) => `\${${k}}`)
      .join("#")}"))
`
  )
  .join("\n")}
#set( $condition = {
  "expression": "${keys
    .map((f, i) => `attribute_not_exists(#id${i})`)
    .join(" AND ")}",
  "expressionNames": {
    ${keys.map((f, i) => `"#id${i}": "${f}"`).join(",\n")}
  }
} )
#if( $context.args.condition )
  #set( $condition.expressionValues = {} )
  #set( $conditionFilterExpressions = $util.parseJson($util.transform.toDynamoDBConditionExpression($context.args.condition)) )
  $util.qr($condition.put("expression", "($condition.expression) AND $conditionFilterExpressions.expression"))
  $util.qr($condition.expressionNames.putAll($conditionFilterExpressions.expressionNames))
  $util.qr($condition.expressionValues.putAll($conditionFilterExpressions.expressionValues))
#end
#if( $condition.expressionValues && $condition.expressionValues.size() == 0 )
  #set( $condition = {
  "expression": $condition.expression,
  "expressionNames": $condition.expressionNames
} )
#end
{
  "version": "2017-02-28",
  "operation": "PutItem",
  "key": #if( $modelObjectKey ) $util.toJson($modelObjectKey) #else {
  "${
    keys[0]
  }":   $util.dynamodb.toDynamoDBJson($util.defaultIfNullOrBlank($ctx.args.input.${
    keys[0]
  }, $util.autoId()))
} #end,
  "attributeValues": $util.dynamodb.toMapValuesJson($context.args.input),
  "condition": $util.toJson($condition)
}
## [End] Prepare DynamoDB PutItem Request. **
`;
};

const buildCreateRes = () => {
  return `
$util.toJson($ctx.result)
  `;
};

const buildUpdateReq = (typeName: string, primaryKey: KeySpec) => {
  const keys = [
    primaryKey.fields[0],
    primaryKey.fields.slice(1).join("#"),
  ].filter((a) => !!a);
  const safeKeys = buildSafePrimaryKeys(primaryKey);
  return `
#if( $authCondition && $authCondition.expression != "" )
  #set( $condition = $authCondition )
  #if( $modelObjectKey )
    #foreach( $entry in $modelObjectKey.entrySet() )
      $util.qr($condition.put("expression", "$condition.expression AND attribute_exists(#keyCondition$velocityCount)"))
      $util.qr($condition.expressionNames.put("#keyCondition$velocityCount", "$entry.key"))
    #end
  #else
    $util.qr($condition.put("expression", "$condition.expression AND ${keys
      .map((k, i) => `attribute_exists(#id${i})`)
      .join(" AND ")}"))
    ${keys
      .map(
        (k, i) => `$util.qr($condition.expressionNames.put("#id${i}", "${k}"))`
      )
      .join("\n")}
  #end
#else
  #if( $modelObjectKey )
    #set( $condition = {
  "expression": "",
  "expressionNames": {},
  "expressionValues": {}
} )
    #foreach( $entry in $modelObjectKey.entrySet() )
      #if( $velocityCount == 1 )
        $util.qr($condition.put("expression", "attribute_exists(#keyCondition$velocityCount)"))
      #else
        $util.qr($condition.put("expression", "$condition.expression AND attribute_exists(#keyCondition$velocityCount)"))
      #end
      $util.qr($condition.expressionNames.put("#keyCondition$velocityCount", "$entry.key"))
    #end
  #else
    #set( $condition = {
  "expression": "${keys
    .map((k, i) => `attribute_exists(#id${i})`)
    .join(" AND ")}",
  "expressionNames": {
${keys.map((k, i) => `"#id${i}": "${k}"`).join(",\n")}
  },
  "expressionValues": {}
} )
  #end
#end
## Automatically set the updatedAt timestamp. **
$util.qr($context.args.input.put("updatedAt", $util.defaultIfNull($ctx.args.input.updatedAt, $util.time.nowISO8601())))
$util.qr($context.args.input.put("__typename", "${typeName}"))
## Update condition if type is @versioned **
#if( $versionedCondition )
  $util.qr($condition.put("expression", "($condition.expression) AND $versionedCondition.expression"))
  $util.qr($condition.expressionNames.putAll($versionedCondition.expressionNames))
  $util.qr($condition.expressionValues.putAll($versionedCondition.expressionValues))
#end
#if( $context.args.condition )
  #set( $conditionFilterExpressions = $util.parseJson($util.transform.toDynamoDBConditionExpression($context.args.condition)) )
  $util.qr($condition.put("expression", "($condition.expression) AND $conditionFilterExpressions.expression"))
  $util.qr($condition.expressionNames.putAll($conditionFilterExpressions.expressionNames))
  $util.qr($condition.expressionValues.putAll($conditionFilterExpressions.expressionValues))
#end
#if( $condition.expressionValues && $condition.expressionValues.size() == 0 )
  #set( $condition = {
  "expression": $condition.expression,
  "expressionNames": $condition.expressionNames
} )
#end
#set( $expNames = {} )
#set( $expValues = {} )
#set( $expSet = {} )
#set( $expAdd = {} )
#set( $expRemove = [] )
#if( $modelObjectKey )
  #set( $keyFields = [] )
  #foreach( $entry in $modelObjectKey.entrySet() )
    $util.qr($keyFields.add("$entry.key"))
  #end
#else
  #set( $keyFields = [${keys.map((k) => `"${k}"`).join(",")}] )
#end
#foreach( $entry in $util.map.copyAndRemoveAllKeys($context.args.input, $keyFields).entrySet() )
  #if( !$util.isNull($dynamodbNameOverrideMap) && $dynamodbNameOverrideMap.containsKey("$entry.key") )
    #set( $entryKeyAttributeName = $dynamodbNameOverrideMap.get("$entry.key") )
  #else
    #set( $entryKeyAttributeName = $entry.key )
  #end
  #if( $util.isNull($entry.value) )
    #set( $discard = $expRemove.add("#$entryKeyAttributeName") )
    $util.qr($expNames.put("#$entryKeyAttributeName", "$entry.key"))
  #else
    $util.qr($expSet.put("#$entryKeyAttributeName", ":$entryKeyAttributeName"))
    $util.qr($expNames.put("#$entryKeyAttributeName", "$entry.key"))
    $util.qr($expValues.put(":$entryKeyAttributeName", $util.dynamodb.toDynamoDB($entry.value)))
  #end
#end
#set( $expression = "" )
#if( !$expSet.isEmpty() )
  #set( $expression = "SET" )
  #foreach( $entry in $expSet.entrySet() )
    #set( $expression = "$expression $entry.key = $entry.value" )
    #if( $foreach.hasNext() )
      #set( $expression = "$expression," )
    #end
  #end
#end
#if( !$expAdd.isEmpty() )
  #set( $expression = "$expression ADD" )
  #foreach( $entry in $expAdd.entrySet() )
    #set( $expression = "$expression $entry.key $entry.value" )
    #if( $foreach.hasNext() )
      #set( $expression = "$expression," )
    #end
  #end
#end
#if( !$expRemove.isEmpty() )
  #set( $expression = "$expression REMOVE" )
  #foreach( $entry in $expRemove )
    #set( $expression = "$expression $entry" )
    #if( $foreach.hasNext() )
      #set( $expression = "$expression," )
    #end
  #end
#end
#set( $update = {} )
$util.qr($update.put("expression", "$expression"))
#if( !$expNames.isEmpty() )
  $util.qr($update.put("expressionNames", $expNames))
#end
#if( !$expValues.isEmpty() )
  $util.qr($update.put("expressionValues", $expValues))
#end
{
  "version": "2017-02-28",
  "operation": "UpdateItem",
  "key": #if( $modelObjectKey ) $util.toJson($modelObjectKey) #else {
${keys
  .map(
    (keyName, i) => `
  "${keyName}": {
      "S": $util.toJson($context.args.input.${safeKeys[i]})
  }
`
  )
  .join(",\n")}
} #end,
  "update": $util.toJson($update),
  "condition": $util.toJson($condition)
}
`;
};

const buildUpdateRes = () => {
  return `
$util.toJson($ctx.result)
  `;
};

const buildDeleteReq = (typeName: string, primaryKey: KeySpec) => {
  const keys = buildPrimaryKeys(primaryKey);
  const inputKeys = buildSafePrimaryKeys(primaryKey);
  return `
#if( $authCondition )
  #set( $condition = $authCondition )
  #if( $modelObjectKey )
    #foreach( $entry in $modelObjectKey.entrySet() )
      $util.qr($condition.put("expression", "$condition.expression AND attribute_exists(#keyCondition$velocityCount)"))
      $util.qr($condition.expressionNames.put("#keyCondition$velocityCount", "$entry.key"))
    #end
  #else
    $util.qr($condition.put("expression", "$condition.expression AND ${keys
      .map((k, i) => `attribute_exists(#id${i})`)
      .join(" AND ")}"))
    ${keys
      .map(
        (k, i) => `$util.qr($condition.expressionNames.put("#id${i}", "${k}"))`
      )
      .join("\n")}
  #end
#else
  #if( $modelObjectKey )
    #set( $condition = {
  "expression": "",
  "expressionNames": {}
} )
    #foreach( $entry in $modelObjectKey.entrySet() )
      #if( $velocityCount == 1 )
        $util.qr($condition.put("expression", "attribute_exists(#keyCondition$velocityCount)"))
      #else
        $util.qr($condition.put("expression", "$condition.expression AND attribute_exists(#keyCondition$velocityCount)"))
      #end
      $util.qr($condition.expressionNames.put("#keyCondition$velocityCount", "$entry.key"))
    #end
  #else
    #set( $condition = {
  "expression": "${keys
    .map((f, i) => `attribute_not_exists(#id${i})`)
    .join(" AND ")}",
  "expressionNames": {
    ${keys.map((f, i) => `"#id${i}": "${f}"`).join(",\n")}
  }
} )
  #end
#end
#if( $versionedCondition )
  $util.qr($condition.put("expression", "($condition.expression) AND $versionedCondition.expression"))
  $util.qr($condition.expressionNames.putAll($versionedCondition.expressionNames))
  #set( $expressionValues = $util.defaultIfNull($condition.expressionValues, {}) )
  $util.qr($expressionValues.putAll($versionedCondition.expressionValues))
  #set( $condition.expressionValues = $expressionValues )
#end
#if( $context.args.condition )
  #set( $conditionFilterExpressions = $util.parseJson($util.transform.toDynamoDBConditionExpression($context.args.condition)) )
  $util.qr($condition.put("expression", "($condition.expression) AND $conditionFilterExpressions.expression"))
  $util.qr($condition.expressionNames.putAll($conditionFilterExpressions.expressionNames))
  #set( $conditionExpressionValues = $util.defaultIfNull($condition.expressionValues, {}) )
  $util.qr($conditionExpressionValues.putAll($conditionFilterExpressions.expressionValues))
  #set( $condition.expressionValues = $conditionExpressionValues )
  $util.qr($condition.expressionValues.putAll($conditionFilterExpressions.expressionValues))
#end
#if( $condition.expressionValues && $condition.expressionValues.size() == 0 )
  #set( $condition = {
  "expression": $condition.expression,
  "expressionNames": $condition.expressionNames
} )
#end
{
  "version": "2017-02-28",
  "operation": "DeleteItem",
  "key": #if( $modelObjectKey ) $util.toJson($modelObjectKey) #else {
  ${keys
    .map(
      (keyName, i) =>
        `"${keyName}": $util.dynamodb.toDynamoDBJson($ctx.args.input.${inputKeys[i]})`
    )
    .join(",\n")}
} #end,
  "condition": $util.toJson($condition)
}
  `;
};

const buildDeleteRes = () => {
  return `
$util.toJson($ctx.result)
  `;
};

const buildHasOne = (yours: string, mine: string) => {
  return [
    `
{
    "version": "2018-05-29",
    "operation": "GetItem",
    "key": {
        "${yours}": $util.dynamodb.toDynamoDBJson($ctx.source.${mine})
    }
}
`,
    `
#if($ctx.error)
  $util.error($ctx.error.message, $ctx.error.type)
#end
#set($res = $ctx.result)
$util.toJson($res)
`,
  ];
};

const buildHasMany = (yours: string, mine: string, indexName: string) => {
  return [
    `
#set( $limit = $util.defaultIfNull($context.args.limit, 100) )
#set( $query = {
  "expression": "#connectionAttribute = :connectionAttribute",
  "expressionNames": {
      "#connectionAttribute": "${yours}"
  },
  "expressionValues": {
      ":connectionAttribute": {
          "S": "$context.source.${mine}"
    }
  }
} )
{
  "version": "2017-02-28",
  "operation": "Query",
  "query":   $util.toJson($query),
  "scanIndexForward":   #if( $context.args.sortDirection )
    #if( $context.args.sortDirection == "ASC" )
true
    #else
false
    #end
  #else
true
  #end,
  "filter":   #if( $context.args.filter )
$util.transform.toDynamoDBFilterExpression($ctx.args.filter)
  #else
null
  #end,
  "limit": $limit,
  "nextToken":   #if( $context.args.nextToken )
$util.toJson($context.args.nextToken)
  #else
null
  #end,
  "index": "${indexName}"
}
`,
    `
$util.toJson($ctx.result)
`,
  ];
};

const buildQueryOperations = (typeName: string, keySpec: KeySpec) => {
  return `
 extend type Query {
  ${keySpec.queryField}(${(() => {
    if (keySpec.fields.length === 1) {
      return `${keySpec.fields[0]}: String`;
    }
    if (keySpec.fields.length === 2) {
      return `${keySpec.fields[0]}: String,  ${keySpec.fields[1]}: ModelStringConditionInput`;
    }
    return `${keySpec.fields[0]}: String,  ${keySpec.fields[1]}${keySpec.fields
      .slice(2)
      .map((f) => f[0].toUpperCase() + f.slice(1))
      .join("")}: Model${typeName}${keySpec.name}CompositeKeyConditionInput`;
  })()},  filter: Model${typeName}FilterInput, limit: Int, nextToken: String): Model${typeName}Connection 
 }
input Model${typeName}${keySpec.name}CompositeKeyConditionInput {
  eq: Model${typeName}${keySpec.name}CompositeKeyInput
  le: Model${typeName}${keySpec.name}CompositeKeyInput
  lt: Model${typeName}${keySpec.name}CompositeKeyInput
  ge: Model${typeName}${keySpec.name}CompositeKeyInput
  gt: Model${typeName}${keySpec.name}CompositeKeyInput
  between: [Model${typeName}${keySpec.name}CompositeKeyInput]
  beginsWith: Model${typeName}${keySpec.name}CompositeKeyInput
}
input Model${typeName}${keySpec.name}CompositeKeyInput {
  ${keySpec.fields
    .slice(1)
    .map((f) => `${f}: String`)
    .join("\n")}
}
`;
};

const buildQueryListReq = (keySpec: KeySpec): string => {
  if (keySpec.fields.length == 2) {
    return `
## [Start] Set query expression for @key **
#set( $modelQueryExpression = {} )
## [Start] Validate key arguments. **
#if( !$util.isNull($ctx.args.${keySpec.fields[1]}) && $util.isNull($ctx.args.${keySpec.fields[0]}) )
  $util.error("When providing argument '${keySpec.fields[1]}' you must also provide arguments ${keySpec.fields[0]}", "InvalidArgumentsError")
#end
## [End] Validate key arguments. **
#if( !$util.isNull($ctx.args.${keySpec.fields[0]}) )
  #set( $modelQueryExpression.expression = "#${keySpec.fields[0]} = :${keySpec.fields[0]}" )
  #set( $modelQueryExpression.expressionNames = {
  "#${keySpec.fields[0]}": "${keySpec.fields[0]}"
} )
  #set( $modelQueryExpression.expressionValues = {
  ":yearMonth": {
      "S": "$ctx.args.${keySpec.fields[0]}"
  }
} )
#end
## [Start] Applying Key Condition **
#if( !$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.beginsWith) )
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND begins_with(#sortKey, :sortKey)" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.beginsWith" }))
#end
#if( !$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.between) )
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey BETWEEN :sortKey0 AND :sortKey1" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey0", { "S": "$ctx.args.${keySpec.fields[1]}.between[0]" }))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey1", { "S": "$ctx.args.${keySpec.fields[1]}.between[1]" }))
#end
#if( !$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.eq) )
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey = :sortKey" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.eq" }))
#end
#if( !$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.lt) )
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey < :sortKey" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.lt" }))
#end
#if( !$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.le) )
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey <= :sortKey" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.le" }))
#end
#if( !$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.gt) )
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey > :sortKey" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.gt" }))
#end
#if( !$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.ge) )
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey >= :sortKey" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.ge" }))
#end
## [End] Applying Key Condition **
## [End] Set query expression for @key **
#set( $limit = $util.defaultIfNull($context.args.limit, 100) )
#set( $QueryRequest = {
  "version": "2017-02-28",
  "operation": "Query",
  "limit": $limit,
  "query": $modelQueryExpression,
  "index": "${keySpec.name}"
} )
#if( !$util.isNull($ctx.args.sortDirection)
                    && $ctx.args.sortDirection == "DESC" )
  #set( $QueryRequest.scanIndexForward = false )
#else
  #set( $QueryRequest.scanIndexForward = true )
#end
#if( $context.args.nextToken ) #set( $QueryRequest.nextToken = $context.args.nextToken ) #end
#if( $context.args.filter ) #set( $QueryRequest.filter = $util.parseJson("$util.transform.toDynamoDBFilterExpression($ctx.args.filter)") ) #end
$util.toJson($QueryRequest)
    `;
  }
  const compositeKey =
    keySpec.fields[1] +
    keySpec.fields
      .slice(2)
      .map((f) => f[0].toUpperCase() + f.slice(1))
      .join("");
  return `
## [Start] Set query expression for @key **
#set( $modelQueryExpression = {} )
#if( !$util.isNull($ctx.args.${keySpec.fields[0]}) )
  #set( $modelQueryExpression.expression = "#${keySpec.fields[0]} = :${
    keySpec.fields[0]
  }" )
  #set( $modelQueryExpression.expressionNames = {
  "#${keySpec.fields[0]}": "${keySpec.fields[0]}"
} )
  #set( $modelQueryExpression.expressionValues = {
  ":${keySpec.fields[0]}": {
      "S": "$ctx.args.${keySpec.fields[0]}"
  }
} )
#end
## [Start] Applying Key Condition **
#set( $sortKeyValue = "" )
#set( $sortKeyValue2 = "" )
#if( !$util.isNull($ctx.args.${compositeKey}) && !$util.isNull($ctx.args.${compositeKey}.beginsWith) )
  #if( !$util.isNull($ctx.args.${compositeKey}.beginsWith.${
    keySpec.fields[1]
  }) ) #set( $sortKeyValue = "$ctx.args.${compositeKey}.beginsWith.${
    keySpec.fields[1]
  }" ) #end
  ${keySpec.fields
    .slice(1)
    .map(
      (f) => `
  #if( !$util.isNull($ctx.args.${compositeKey}.beginsWith.${f}) ) #set( $sortKeyValue = "$sortKeyValue#$ctx.args.${compositeKey}.beginsWith.${f}" ) #end
  `
    )
    .join("\n")}
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND begins_with(#sortKey, :sortKey)" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields
    .slice(1)
    .join("#")}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$sortKeyValue" }))
#end
#if( !$util.isNull($ctx.args.${compositeKey}) && !$util.isNull($ctx.args.${compositeKey}.between) )
  #if( $ctx.args.${compositeKey}.between.size() != 2 )
    $util.error("Argument ${compositeKey}.between expects exactly 2 elements.")
  #end
  #if( !$util.isNull($ctx.args.${compositeKey}.between[0].${
    keySpec.fields[1]
  }) ) #set( $sortKeyValue = "$ctx.args.${compositeKey}.between[0].${
    keySpec.fields[1]
  }" ) #end
  ${keySpec.fields
    .slice(2)
    .map(
      (f) => `
  #if( !$util.isNull($ctx.args.${compositeKey}.between[0].${f}) ) #set( $sortKeyValue = "$sortKeyValue#$ctx.args.${compositeKey}.between[0].${f}" ) #end
  `
    )
    .join("\n")}
  #if( !$util.isNull($ctx.args.${compositeKey}.between[1].${
    keySpec.fields[1]
  }) ) #set( $sortKeyValue2 = "$ctx.args.${compositeKey}.between[1].${
    keySpec.fields[1]
  }" ) #end
  ${keySpec.fields
    .slice(2)
    .map(
      (f) => `
  #if( !$util.isNull($ctx.args.${compositeKey}.between[1].${f}) ) #set( $sortKeyValue2 = "$sortKeyValue2#$ctx.args.${compositeKey}.between[1].${f}" ) #end
  `
    )
    .join("\n")}
    #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey BETWEEN :sortKey0 AND :sortKey1" )
    $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields
      .slice(1)
      .join("#")}"))
    $util.qr($modelQueryExpression.expressionValues.put(":sortKey0", { "S": "$sortKeyValue" }))
    $util.qr($modelQueryExpression.expressionValues.put(":sortKey1", { "S": "$sortKeyValue2" }))
#end
${["eq", "lt", "gt", "le", "ge"]
  .map(
    (operator) => `
#if( !$util.isNull($ctx.args.${compositeKey}) && !$util.isNull($ctx.args.${compositeKey}.${operator}) )
  #if( !$util.isNull($ctx.args.${compositeKey}.${operator}.${
      keySpec.fields[1]
    }) ) #set( $sortKeyValue = "$ctx.args.${compositeKey}.${operator}.${
      keySpec.fields[1]
    }" ) #end
  ${keySpec.fields
    .slice(2)
    .map(
      (f) => `
  #if( !$util.isNull($ctx.args.${compositeKey}.${operator}.${f}) ) #set( $sortKeyValue = "$sortKeyValue#$ctx.args.${compositeKey}.${operator}.${f}" ) #end
  `
    )
    .join("\n")}
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey ${(() => {
    switch (operator) {
      case "eq":
        return "=";
      case "lt":
        return "<";
      case "le":
        return "<=";
      case "gt":
        return ">";
      case "ge":
        return ">=";
    }
  })()} :sortKey" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields
    .slice(1)
    .join("#")}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$sortKeyValue" }))
#end
  `
  )
  .join("\n")}
## [End] Applying Key Condition **
## [End] Set query expression for @key **
#set( $limit = $util.defaultIfNull($context.args.limit, 100) )
#set( $QueryRequest = {
  "version": "2017-02-28",
  "operation": "Query",
  "limit": $limit,
  "query": $modelQueryExpression,
  "index": "${keySpec.name}"
} )
#if( !$util.isNull($ctx.args.sortDirection)
                    && $ctx.args.sortDirection == "DESC" )
  #set( $QueryRequest.scanIndexForward = false )
#else
  #set( $QueryRequest.scanIndexForward = true )
#end
#if( $context.args.nextToken ) #set( $QueryRequest.nextToken = $context.args.nextToken ) #end
#if( $context.args.filter ) #set( $QueryRequest.filter = $util.parseJson("$util.transform.toDynamoDBFilterExpression($ctx.args.filter)") ) #end
$util.toJson($QueryRequest)
`;
};

const buildQueryListRes = () => {
  return `
$util.toJson($ctx.result)
    `;
};
