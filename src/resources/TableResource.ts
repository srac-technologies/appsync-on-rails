import {
  DocumentNode,
  FieldDefinitionNode,
  InputValueDefinitionNode,
  Kind,
  ObjectTypeDefinitionNode,
  print,
} from "graphql";
import { ResourceDefinition } from "../interfaces/resource/IResource";
import { Printable } from "../interfaces/resource/Printable";
import { args } from "../io/CliArgs";
import { DiggerUtils, typeEasy, unTypeEasy } from "../utils/DiggerUtils";

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
  sortableWith?: string[];
  custom: boolean;
};

export type AuthOwnerStrategySpec = {
  type: "OWNER";
  ownerField: string;
  identityClaim?: string;
};

export type AuthGroupStrategySpec = {
  type: "GROUP";
  groups: string[];
  groupClaim?: string;
};

export type AuthStrategySpec = AuthOwnerStrategySpec | AuthGroupStrategySpec;

export type ActionType = "create" | "update" | "read" | "delete";

export type AuthUserPoolsSpec = {
  provider: "AMAZON_COGNITO_USER_POOLS";
  strategy: AuthStrategySpec;
};

export type AuthKeySpec = {
  provider: "API_KEY";
};
export type AuthIamSpec = {
  provider: "AWS_IAM";
};

export type AuthBaseSpec = {
  actions: ActionType[];
};

export type AuthSpec = (AuthUserPoolsSpec | AuthKeySpec | AuthIamSpec) &
  AuthBaseSpec;

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

  private uniqueFields: string[] = [];

  authSpec: {
    self: AuthSpec[];
    fields: {
      [fieldName: string]: AuthSpec[];
    };
  } = {
    self: [],
    fields: {},
  };

  constructor(
    private tableName: string,
    private provider: "DYNAMODB" | "AURORA_MYSQL",
    private typeNode: ObjectTypeDefinitionNode,
    private context: DocumentNode
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
  hasUnique(field: string) {
    this.uniqueFields.push(field);
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

  addAuth(spec: AuthSpec, on?: FieldDefinitionNode) {
    if (!on) {
      this.authSpec.self.push(spec);
      return;
    }
    this.authSpec.fields[on.name.value] = [
      ...(this.authSpec.fields[on.name.value] || []),
      spec,
    ];
  }

  print() {
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
                      TableName: `${this.tableName}_\${self:provider.stage}`,
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
                      BillingMode: "PAY_PER_REQUEST",
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
        resource: buildUpdateReq(
          this.tableName,
          this.primaryKey,
          this.authSpec.self
        ),
      },
      {
        location: `mapping-templates/Mutation.delete${this.tableName}.request.vtl`,
        path: "",
        resource: buildDeleteReq(this.tableName, this.primaryKey),
      },
      {
        location: `mapping-templates/Query.get${this.tableName}.response.vtl`,
        path: "",
        resource: buildGetRes(this.authSpec.self),
      },
      {
        location: `mapping-templates/Query.list${this.tableName}s.response.vtl`,
        path: "",
        resource: buildListRes(this.authSpec.self),
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
          this.connections,
          this.authSpec.self,
          this.context
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
      {
        location: `schema/${args["in-schema"]}`,
        path: DiggerUtils.removeObjectDirective(this.tableName, "auth"),
        resource: {},
      },
      {
        location: `schema/${args["in-schema"]}`,
        path: DiggerUtils.addObjectDirectives(
          this.tableName,
          buildAuthDirectiveNames(this.authSpec.self)
        ),
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
        noReplace: c.custom,
        resource: c.hasMany
          ? buildHasMany(
              this.primaryKey.fields[0] || "",
              getForeignKey(c, this.tableName, true),
              c.name,
              c.with,
              c.sortableWith
            )[0]
          : buildHasOne(
              TableResource.table(c.with)?.primaryKey.fields[0] || "",
              getForeignKey(c, this.tableName),
              c.with
            )[0],
      })),
      ...this.connections.map((c) => ({
        location: `mapping-templates/${this.tableName}.${c.node.name.value}.response.vtl`,
        path: "",
        noReplace: c.custom,
        resource: c.hasMany
          ? buildHasMany(
              this.primaryKey.fields[0] || "",
              getForeignKey(c, this.tableName, true),
              c.name,
              c.with,
              c.sortableWith
            )[1]
          : buildHasOne(
              TableResource.table(c.with)?.primaryKey.fields[0] || "",
              getForeignKey(c, this.tableName),
              c.with
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
                  listRequired: false,
                });
              }
              return c.node.type;
            })(),
            arguments: c.hasMany ? buildHasManyConnectionArguments(c) : [],
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
            resource: buildListRes(this.authSpec.self),
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

  public protectListRes() {
    return buildAuthListRes(this.authSpec.self);
  }
  public protectGetRes() {
    return buildGetAuthRes(this.authSpec.self);
  }
}

const getForeignKey = (
  connection: ConnectionSpec,
  tableName: string,
  hasMany: boolean = false
) => {
  if (hasMany) {
    return (
      connection.foreignKey ||
      `${
        connection.with[0].toLowerCase() + connection.with.slice(1)
      }${tableName}Id`
    );
  }
  return (
    connection.foreignKey ||
    `${tableName[0].toLowerCase() + tableName.slice(1)}${connection.with}Id`
  );
};

const buildHasManyConnectionArguments = (c: ConnectionSpec) => {
  if (!c.sortableWith) {
    return [
      {
        kind: "InputValueDefinition",
        name: { value: "filter", kind: "Name" },
        type: {
          kind: "NamedType",
          name: {
            value: `Model${unTypeEasy(c.node).baseTypeName}FilterInput`,
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
    ];
  }

  return [
    {
      kind: "InputValueDefinition",
      name: { value: "filter", kind: "Name" },
      type: {
        kind: "NamedType",
        name: {
          value: `Model${unTypeEasy(c.node).baseTypeName}FilterInput`,
          kind: "Name",
        },
      },
    },
    {
      kind: "InputValueDefinition",
      name: {
        value:
          c.sortableWith[0] +
          c.sortableWith
            .slice(1)
            .map((k) => k[0].toUpperCase() + k.slice(1))
            .join(""),
        kind: "Name",
      },
      type: {
        kind: "NamedType",
        name: {
          value: `Model${c.name}${
            c.sortableWith.length === 1
              ? "KeyCondition"
              : "CompositeKeyCondition"
          }Input`,
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
  ];
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
      ].filter(
        (k, i, a) =>
          a.map((ak) => ak.AttributeName).indexOf(k.AttributeName) === i
      ),
      GlobalSecondaryIndexes: [
        ...keys
          .filter((k) => k.name)
          .map((k) => ({
            IndexName: k.name,
            KeySchema: buildKey(k.fields),
            Projection: {
              ProjectionType: "ALL",
            },
          })),
        ...belongsTos
          .filter((b) => !b.custom)
          .map((b) => ({
            IndexName: b.name,
            KeySchema: [
              {
                AttributeName:
                  b.foreignKey ||
                  `${self[0].toLowerCase() + self.slice(1)}${b.with}Id`,
                KeyType: "HASH",
              },
              ...(b.sortableWith
                ? [
                    {
                      AttributeName: b.sortableWith.join("#"),
                      KeyType: "RANGE",
                    },
                  ]
                : []),
            ],
            Projection: {
              ProjectionType: "ALL",
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
        (d) => d.name.value !== "connection" && d.name.value !== "unique"
      ),
    };
  }

  switch (f.type.kind) {
    case "ListType":
      return {
        ...f,
        kind: "InputValueDefinition",
        directives: (f.directives || []).filter(
          (d) => d.name.value !== "connection" && d.name.value !== "unique"
        ),
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
        directives: (f.directives || []).filter(
          (d) => d.name.value !== "connection" && d.name.value !== "unique"
        ),
      };
    case "NonNullType":
      switch (f.type.type.kind) {
        case "ListType":
          return {
            ...f,
            kind: "InputValueDefinition",
            directives: (f.directives || []).filter(
              (d) => d.name.value !== "connection" && d.name.value !== "unique"
            ),
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
            directives: (f.directives || []).filter(
              (d) => d.name.value !== "connection" && d.name.value !== "unique"
            ),
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

const buildSortKeyQueryOperations = (
  typeName: string,
  keySpecs: KeySpec[],
  authSpec: AuthSpec[]
) => {
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
    })()}, sortDirection:ModelSortDirection, filter: Model${typeName}FilterInput, limit: Int, nextToken: String): Model${typeName}Connection ${buildAuthDirectives(
      authSpec,
      "read"
    )}
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

const buildConnectionKeyInputs = (connections: ConnectionSpec[]) => {
  return connections
    .filter((c) => c.sortableWith)
    .map((connection) =>
      (connection.sortableWith?.length || 0) > 1
        ? `
input Model${connection.name}CompositeKeyConditionInput {
  eq: Model${connection.name}CompositeKeyInput
  le: Model${connection.name}CompositeKeyInput
  lt: Model${connection.name}CompositeKeyInput
  ge: Model${connection.name}CompositeKeyInput
  gt: Model${connection.name}CompositeKeyInput
  between: [Model${connection.name}CompositeKeyInput]
  beginsWith: Model${connection.name}CompositeKeyInput
}

input Model${connection.name}CompositeKeyInput {
  ${connection.sortableWith?.map((f) => `${f}: String`).join("\n")}
}
    
    `
        : `
input Model${connection.name}KeyConditionInput {
  eq: Model${connection.name}KeyInput
  le: Model${connection.name}KeyInput
  lt: Model${connection.name}KeyInput
  ge: Model${connection.name}KeyInput
  gt: Model${connection.name}KeyInput
  between: [Model${connection.name}KeyInput]
  beginsWith: Model${connection.name}KeyInput
}

input Model${connection.name}KeyInput {
  ${(connection.sortableWith || [])[0] || ""}: String
}
`
    )
    .join("\n");
};

const buildAuthDirectives = (authSpec: AuthSpec[], action: ActionType) => {
  return authSpec
    .filter((spec) => spec.actions.includes(action))
    .map(buildAuthDirective)
    .filter((d, i, a) => a.indexOf(d) === i)
    .map((s) => "@" + s)
    .join(" ");
};

const buildAuthDirectiveNames = (authSpec: AuthSpec[]) => {
  return authSpec.map(buildAuthDirective);
};

const buildAuthDirective = (authSpec: AuthSpec) => {
  switch (authSpec.provider) {
    case "AMAZON_COGNITO_USER_POOLS":
    default:
      return "aws_cognito_user_pools";
    case "API_KEY":
      return "aws_api_key";
    case "AWS_IAM":
      return "aws_iam";
  }
};

const buildCrudOperations = (
  typeName: string,
  primaryKey: KeySpec,
  typeNode: ObjectTypeDefinitionNode,
  sortKeys: KeySpec[],
  connections: ConnectionSpec[],
  authSpec: AuthSpec[],
  context: DocumentNode
) => {
  const keyOperations = buildSortKeyQueryOperations(
    typeName,
    sortKeys,
    authSpec
  );
  const connectionKeys = buildConnectionKeyInputs(connections);
  return `
 extend type Query {
  get${typeName}(${buildSafePrimaryKeys(primaryKey)
    .map((k) => `${k}: ID!`)
    .join(",")}): ${typeName} ${buildAuthDirectives(authSpec, "read")}
  list${typeName}s(filter: Model${typeName}FilterInput, limit: Int, nextToken: String): Model${typeName}Connection ${buildAuthDirectives(
    authSpec,
    "read"
  )}
  ${keyOperations.map((o) => o.query).join("\n")} 
 }
 extend type Mutation {
  create${typeName}(input: Create${typeName}Input!, condition: Model${typeName}ConditionInput): ${typeName} ${buildAuthDirectives(
    authSpec,
    "create"
  )}
  update${typeName}(input: Update${typeName}Input!, condition: Model${typeName}ConditionInput): ${typeName} ${buildAuthDirectives(
    authSpec,
    "update"
  )}
  delete${typeName}(input: Delete${typeName}Input!, condition: Model${typeName}ConditionInput): ${typeName} ${buildAuthDirectives(
    authSpec,
    "delete"
  )}
 }
 type Model${typeName}Connection 
 ${buildAuthDirectives(authSpec, "read")}
 {
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
           ) &&
           !connections.some(
             (c) => c.node.name.value === f.name.value && c.custom
           ) &&
           !context.definitions.some(
             (d) =>
               d.kind === "ObjectTypeDefinition" &&
               d.name.value === unTypeEasy(f).baseTypeName
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
           ) &&
           !connections.some(
             (c) => c.node.name.value === f.name.value && c.custom
           ) &&
           !context.definitions.some(
             (d) =>
               d.kind === "ObjectTypeDefinition" &&
               d.name.value === unTypeEasy(f).baseTypeName
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
         ) &&
         !connections.some(
           (c) => c.node.name.value === f.name.value && c.custom
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
               (d) => d.name.value !== "connection" && d.name.value !== "unique"
             ),
           }
         : {
             ...f,
             type: (() => {
               const t = unTypeEasy(f);
               return typeEasy({
                 ...t,
                 baseTypeName: context.definitions.some(
                   (d) =>
                     d.kind === "ObjectTypeDefinition" &&
                     d.name.value === t.baseTypeName
                 )
                   ? t.baseTypeName + "Input"
                   : t.baseTypeName,
               });
             })(),
             kind: "InputValueDefinition",
             directives: (f.directives || []).filter(
               (d) => d.name.value !== "connection" && d.name.value !== "unique"
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
         ) &&
         !connections.some(
           (c) => c.node.name.value === f.name.value && c.custom
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
               (d) => d.name.value !== "connection" && d.name.value !== "unique"
             ),
           }
         : {
             ...f,
             kind: "InputValueDefinition",
             directives: (f.directives || []).filter(
               (d) => d.name.value !== "connection" && d.name.value !== "unique"
             ),
             type: (() => {
               const t = unTypeEasy(f);
               return typeEasy({
                 ...t,
                 baseTypeName: context.definitions.some(
                   (d) =>
                     d.kind === "ObjectTypeDefinition" &&
                     d.name.value === t.baseTypeName
                 )
                   ? t.baseTypeName + "Input"
                   : t.baseTypeName,
               });
             })(),
           };
     }),
 })}
 input Delete${typeName}Input {
    ${buildSafePrimaryKeys(primaryKey)
      .map((pk) => `${pk}: ID!`)
      .join("\n")}
 }
 ${keyOperations.map((o) => o.inputs).join("\n")}
 ${connectionKeys}
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

const buildGetRes = (authSpecs: AuthSpec[]) => {
  return `
  ${buildGetAuthRes(authSpecs)}
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

const buildListRes = (authSpecs: AuthSpec[]) => {
  return `
  ${buildAuthListRes(authSpecs)}
$util.toJson($ctx.result)
  `;
};

const buildGetAuthRes = (authSpecs: AuthSpec[]) => {
  const relatedAuth = authSpecs
    .filter((a) => a.actions.includes("read"))
    .filter((a) => a.provider === "AMAZON_COGNITO_USER_POOLS");
  if (relatedAuth.length === 0) {
    return "";
  }

  const staticGroupAuthorization = (s: AuthSpec[]) => {
    return s
      .filter(
        (spec) =>
          spec.provider === "AMAZON_COGNITO_USER_POOLS" &&
          spec.strategy.type === "GROUP"
      )
      .map((spec: AuthSpec) => {
        const strategy = <AuthGroupStrategySpec>(
          (<AuthUserPoolsSpec>spec).strategy
        );
        return `
  ## Authorization rule: { groups: ${strategy.groups.toString()}, groupClaim: "${
          strategy.groupClaim || "cognito:groups"
        }" } **
  #set( $userGroups = $util.defaultIfNull($ctx.identity.claims.get("${
    strategy.groupClaim || "cognito:groups"
  }"), []) )
  #set( $allowedGroups = [${strategy.groups
    .map((g) => '"' + g + '"')
    .join(",")}] )
  #foreach( $userGroup in $userGroups )
    #if( $allowedGroups.contains($userGroup) )
      #set( $isStaticGroupAuthorized = true )
      #break
    #end
  #end
  `;
      })
      .join("\n");
  };

  const ownerAuthorization = (s: AuthSpec[]) => {
    return s
      .filter(
        (spec) =>
          spec.provider === "AMAZON_COGNITO_USER_POOLS" &&
          spec.strategy.type === "OWNER"
      )
      .map((spec, index) => {
        const strategy = <AuthOwnerStrategySpec>(
          (<AuthUserPoolsSpec>spec).strategy
        );
        return `
  ## Authorization rule: { allow: owner, ownerField: "${
    strategy.ownerField
  }", identityClaim: "${strategy.identityClaim || "cognito:username"}" } **
  #set( $allowedOwners${index} = $ctx.result.${strategy.ownerField} )
  #set( $identityValue = $util.defaultIfNull($ctx.identity.claims.get("username"), $util.defaultIfNull($ctx.identity.claims.get("${
    strategy.identityClaim || "cognito:username"
  }"), "___xamznone____")) )
  #if( $util.isList($allowedOwners${index}) )
    #foreach( $allowedOwner in $allowedOwners${index} )
      #if( $allowedOwner == $identityValue )
        #set( $isOwnerAuthorized = true )
      #end
    #end
  #end
  #if( $util.isString($allowedOwners${index}) )
    #if( $allowedOwners${index} == $identityValue )
      #set( $isOwnerAuthorized = true )
    #end
  #end
  `;
      });
  };
  return `
## [Start] return null early if null **
#if( $util.isNullOrEmpty($ctx.result) )
#return
#end
## [End] return null early if null **
## [Start] Determine request authentication mode **
#if( $util.isNullOrEmpty($authMode) && !$util.isNull($ctx.identity) && !$util.isNull($ctx.identity.sub) && !$util.isNull($ctx.identity.issuer) && !$util.isNull($ctx.identity.username) && !$util.isNull($ctx.identity.claims) && !$util.isNull($ctx.identity.sourceIp) && !$util.isNull($ctx.identity.defaultAuthStrategy) )
  #set( $authMode = "userPools" )
#end
## [End] Determine request authentication mode **
## [Start] Check authMode and execute owner/group checks **
#if( $authMode == "userPools" )
  ## [Start] Static Group Authorization Checks **
  #set($isStaticGroupAuthorized = $util.defaultIfNull(
            $isStaticGroupAuthorized, false))
${staticGroupAuthorization(authSpecs)}
  ## [End] Static Group Authorization Checks **
  ## [Start] Owner Authorization Checks **
  #set( $isOwnerAuthorized = $util.defaultIfNull($isOwnerAuthorized, false) )
${ownerAuthorization(authSpecs)}
  ## [End] Owner Authorization Checks **


  ## [Start] Throw if unauthorized **
  #if( !($isStaticGroupAuthorized == true || $isDynamicGroupAuthorized == true || $isOwnerAuthorized == true) )
    $util.unauthorized()
  #end
  ## [End] Throw if unauthorized **
#end
## [End] Check authMode and execute owner/group checks **

`;
};

const buildAuthReq = (authSpecs: AuthSpec[], action: ActionType) => {
  const relatedAuth = authSpecs
    .filter((a) => a.actions.includes(action))
    .filter((a) => a.provider === "AMAZON_COGNITO_USER_POOLS");
  if (relatedAuth.length === 0) {
    return "";
  }

  const staticGroupAuthorization = (s: AuthSpec[]) => {
    return s
      .filter(
        (spec) =>
          spec.provider === "AMAZON_COGNITO_USER_POOLS" &&
          spec.strategy.type === "GROUP"
      )
      .map((spec: AuthSpec) => {
        const strategy = <AuthGroupStrategySpec>(
          (<AuthUserPoolsSpec>spec).strategy
        );
        return `
  ## Authorization rule: { groups: ${strategy.groups.toString()}, groupClaim: "${
          strategy.groupClaim || "cognito:groups"
        }" } **
  #set( $userGroups = $util.defaultIfNull($ctx.identity.claims.get("${
    strategy.groupClaim || "cognito:groups"
  }"), []) )
  #set( $allowedGroups = [${strategy.groups
    .map((g) => '"' + g + '"')
    .join(",")}] )
  #foreach( $userGroup in $userGroups )
    #if( $allowedGroups.contains($userGroup) )
      #set( $isStaticGroupAuthorized = true )
      #break
    #end
  #end
  `;
      })
      .join("\n");
  };

  const ownerAuthorization = (s: AuthSpec[]) => {
    return s
      .filter(
        (spec) =>
          spec.provider === "AMAZON_COGNITO_USER_POOLS" &&
          spec.strategy.type === "OWNER"
      )
      .map((spec, index) => {
        const strategy = <AuthOwnerStrategySpec>(
          (<AuthUserPoolsSpec>spec).strategy
        );
        return `
    ## Authorization rule: { allow: owner, ownerField: "${
      strategy.ownerField
    }", identityClaim: "${strategy.identityClaim || "cognito:username"}" } **
    $util.qr($ownerAuthExpressions.add("#owner${index} = :identity${index}"))
    $util.qr($ownerAuthExpressionNames.put("#owner${index}", "${
          strategy.ownerField
        }"))
    $util.qr($ownerAuthExpressionValues.put(":identity${index}", $util.dynamodb.toDynamoDB($util.defaultIfNull($ctx.identity.claims.get("username"), $util.defaultIfNull($ctx.identity.claims.get("${
          strategy.identityClaim || "cognito:username"
        }"), "___xamznone____")))))
  `;
      });
  };

  const template = `
## [Start] Determine request authentication mode **
#if( $util.isNullOrEmpty($authMode) && !$util.isNull($ctx.identity) && !$util.isNull($ctx.identity.sub) && !$util.isNull($ctx.identity.issuer) && !$util.isNull($ctx.identity.username) && !$util.isNull($ctx.identity.claims) && !$util.isNull($ctx.identity.sourceIp) && !$util.isNull($ctx.identity.defaultAuthStrategy) )
  #set( $authMode = "userPools" )
#end
## [End] Determine request authentication mode **
## [Start] Check authMode and execute owner/group checks **
#if( $authMode == "userPools" )
  ## [Start] Static Group Authorization Checks **
  #set($isStaticGroupAuthorized = $util.defaultIfNull(
            $isStaticGroupAuthorized, false))
${staticGroupAuthorization(authSpecs)}
  ## [End] Static Group Authorization Checks **
  #if( ! $isStaticGroupAuthorized )
    ## [Start] Owner Authorization Checks **
    #set( $ownerAuthExpressions = [] )
    #set( $ownerAuthExpressionValues = {} )
    #set( $ownerAuthExpressionNames = {} )
${ownerAuthorization(authSpecs)}
    ## [End] Owner Authorization Checks **


    ## [Start] Collect Auth Condition **
    #set( $authCondition = $util.defaultIfNull($authCondition, {
  "expression": "",
  "expressionNames": {},
  "expressionValues": {}
}) )
    #set( $totalAuthExpression = "" )
    ## Add dynamic group auth conditions if they exist **
    #if( $groupAuthExpressions )
      #foreach( $authExpr in $groupAuthExpressions )
        #set( $totalAuthExpression = "$totalAuthExpression $authExpr" )
        #if( $foreach.hasNext )
          #set( $totalAuthExpression = "$totalAuthExpression OR" )
        #end
      #end
    #end
    #if( $groupAuthExpressionNames )
      $util.qr($authCondition.expressionNames.putAll($groupAuthExpressionNames))
    #end
    #if( $groupAuthExpressionValues )
      $util.qr($authCondition.expressionValues.putAll($groupAuthExpressionValues))
    #end
    ## Add owner auth conditions if they exist **
    #if( $totalAuthExpression != "" && $ownerAuthExpressions && $ownerAuthExpressions.size() > 0 )
      #set( $totalAuthExpression = "$totalAuthExpression OR" )
    #end
    #if( $ownerAuthExpressions )
      #foreach( $authExpr in $ownerAuthExpressions )
        #set( $totalAuthExpression = "$totalAuthExpression $authExpr" )
        #if( $foreach.hasNext )
          #set( $totalAuthExpression = "$totalAuthExpression OR" )
        #end
      #end
    #end
    #if( $ownerAuthExpressionNames )
      $util.qr($authCondition.expressionNames.putAll($ownerAuthExpressionNames))
    #end
    #if( $ownerAuthExpressionValues )
      $util.qr($authCondition.expressionValues.putAll($ownerAuthExpressionValues))
    #end
    ## Set final expression if it has changed. **
    #if( $totalAuthExpression != "" )
      #if( $util.isNullOrEmpty($authCondition.expression) )
        #set( $authCondition.expression = "($totalAuthExpression)" )
      #else
        #set( $authCondition.expression = "$authCondition.expression AND ($totalAuthExpression)" )
      #end
    #end
    ## [End] Collect Auth Condition **
  #end


  ## [Start] Throw if unauthorized **
  #if( !($isStaticGroupAuthorized == true || ($totalAuthExpression != "")) )
    $util.unauthorized()
  #end
  ## [End] Throw if unauthorized **
#end
## [End] Check authMode and execute owner/group checks **


`;
  return template;
};

const buildAuthListRes = (authSpecs: AuthSpec[]) => {
  const relatedAuth = authSpecs
    .filter((a) => a.actions.includes("read"))
    .filter((a) => a.provider === "AMAZON_COGNITO_USER_POOLS");
  if (relatedAuth.length === 0) {
    return "";
  }

  const staticGroupAuthorization = (s: AuthSpec[]) => {
    return s
      .filter(
        (spec) =>
          spec.provider === "AMAZON_COGNITO_USER_POOLS" &&
          spec.strategy.type === "GROUP"
      )
      .map((spec: AuthSpec) => {
        const strategy = <AuthGroupStrategySpec>(
          (<AuthUserPoolsSpec>spec).strategy
        );
        return `
  ## Authorization rule: { groups: ${strategy.groups.toString()}, groupClaim: "${
          strategy.groupClaim || "cognito:groups"
        }" } **
  #set( $userGroups = $util.defaultIfNull($ctx.identity.claims.get("${
    strategy.groupClaim || "cognito:groups"
  }"), []) )
  #set( $allowedGroups = [${strategy.groups
    .map((g) => '"' + g + '"')
    .join(",")}] )
  #foreach( $userGroup in $userGroups )
    #if( $allowedGroups.contains($userGroup) )
      #set( $isStaticGroupAuthorized = true )
      #break
    #end
  #end
  `;
      })
      .join("\n");
  };

  const ownerAuthorization = (s: AuthSpec[]) => {
    return s
      .filter(
        (spec) =>
          spec.provider === "AMAZON_COGNITO_USER_POOLS" &&
          spec.strategy.type === "OWNER"
      )
      .map((spec, index) => {
        const strategy = <AuthOwnerStrategySpec>(
          (<AuthUserPoolsSpec>spec).strategy
        );
        return `
  ## Authorization rule: { allow: owner, ownerField: "${
    strategy.ownerField
  }", identityClaim: "${strategy.identityClaim || "cognito:username"}" } **
      #set( $allowedOwners${index} = $item.${strategy.ownerField} )
      #set( $identityValue = $util.defaultIfNull($ctx.identity.claims.get("username"), $util.defaultIfNull($ctx.identity.claims.get("${
        strategy.identityClaim || "cognito:username"
      }"), "___xamznone____")) )
      #if( $util.isList($allowedOwners${index}) )
        #foreach( $allowedOwner in $allowedOwners${index} )
          #if( $allowedOwner == $identityValue )
            #set( $isLocalOwnerAuthorized = true )
          #end
        #end
      #end
      #if( $util.isString($allowedOwners${index}) )
        #if( $allowedOwners${index} == $identityValue )
          #set( $isLocalOwnerAuthorized = true )
        #end
      #end
  `;
      });
  };
  return `
## [Start] Determine request authentication mode **
#if( $util.isNullOrEmpty($authMode) && !$util.isNull($ctx.identity) && !$util.isNull($ctx.identity.sub) && !$util.isNull($ctx.identity.issuer) && !$util.isNull($ctx.identity.username) && !$util.isNull($ctx.identity.claims) && !$util.isNull($ctx.identity.sourceIp) && !$util.isNull($ctx.identity.defaultAuthStrategy) )
  #set( $authMode = "userPools" )
#end
## [End] Determine request authentication mode **
## [Start] Check authMode and execute owner/group checks **
#if( $authMode == "userPools" )
  ## [Start] Static Group Authorization Checks **
  #set($isStaticGroupAuthorized = $util.defaultIfNull(
            $isStaticGroupAuthorized, false))
${staticGroupAuthorization(authSpecs)}
  ## [End] Static Group Authorization Checks **
  ## [Start] If not static group authorized, filter items **
  #if( !$isStaticGroupAuthorized )
    #set( $items = [] )
    #foreach( $item in $ctx.result.items )
      ## No Dynamic Group Authorization Rules **


      ## [Start] Owner Authorization Checks **
      #set( $isLocalOwnerAuthorized = false )
${ownerAuthorization(authSpecs)}
      ## [End] Owner Authorization Checks **


      #if( ($isLocalDynamicGroupAuthorized == true || $isLocalOwnerAuthorized == true) )
        $util.qr($items.add($item))
      #end
    #end
    #set( $ctx.result.items = $items )
  #end
  ## [End] If not static group authorized, filter items **
## [End] Check authMode and execute owner/group checks **
#end
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
      .map((k) => `\${ctx.args.input.${k}}`)
      .join("#")}"))
`
  )
  .join("\n")}
#set( $condition = {
  "expression": "${[
    keys.map((f, i) => `attribute_not_exists(#id${i})`).join(" AND "),
  ].join(" AND ")}",
  "expressionNames": {
    ${[keys.map((f, i) => `"#id${i}": "${f}"`).join(",\n")].join(",\n")}
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

const buildUpdateReq = (
  typeName: string,
  primaryKey: KeySpec,
  authSpecs: AuthSpec[]
) => {
  const keys = [
    primaryKey.fields[0],
    primaryKey.fields.slice(1).join("#"),
  ].filter((a) => !!a);
  const safeKeys = buildSafePrimaryKeys(primaryKey);
  const authExpression = buildAuthReq(authSpecs, "update");
  return `
  ${authExpression}
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
    .map((f, i) => `attribute_exists(#id${i})`)
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

const buildHasOne = (yours: string, mine: string, typeName: string) => {
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
    buildHasOneRes(typeName),
  ];
};

const buildHasMany = (
  belongingKey: string,
  foreignKey: string,
  indexName: string,
  typeName: string,
  sortableWith?: string[]
) => {
  if (sortableWith) {
    return [
      buildHasManyQueryListReq(
        belongingKey,
        foreignKey,
        indexName,
        typeName,
        sortableWith
      ),
      buildHasManyRes(typeName),
    ];
  }

  return [
    `
#set( $limit = $util.defaultIfNull($context.args.limit, 100) )
#set( $query = {
  "expression": "#connectionAttribute = :connectionAttribute",
  "expressionNames": {
      "#connectionAttribute": "${foreignKey}"
  },
  "expressionValues": {
      ":connectionAttribute": {
          "S": "$context.source.${belongingKey}"
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
    buildHasManyRes(typeName),
  ];
};

const buildHasManyQueryListReq = (
  belongingKey: string,
  foreignKey: string,
  indexName: string,
  typeName: string,
  sortableWith: string[]
): string => {
  const keySpec: KeySpec = {
    fields: [foreignKey, ...sortableWith],
    name: indexName,
  };
  if (keySpec.fields.length === 2) {
    return `
##[Start] Set query expression for @key **
#set($modelQueryExpression = {})
#if(!$util.isNull($ctx.source.${belongingKey}))
  #set($modelQueryExpression.expression = "#${foreignKey} = :${belongingKey}")
  #set($modelQueryExpression.expressionNames = {
  "#${foreignKey}": "${foreignKey}"
})
  #set($modelQueryExpression.expressionValues = {
  ":${belongingKey}": {
    "S": "$ctx.source.${belongingKey}"
  }
})
#end
##[Start] Applying Key Condition **
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.beginsWith))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND begins_with(#sortKey, :sortKey)")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.beginsWith" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.between))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey BETWEEN :sortKey0 AND :sortKey1")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey0", { "S": "$ctx.args.${keySpec.fields[1]}.between[0]" }))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey1", { "S": "$ctx.args.${keySpec.fields[1]}.between[1]" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.eq))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey = :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.eq" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.lt))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey < :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.lt" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.le))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey <= :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.le" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.gt))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey > :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.gt" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.ge))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey >= :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.ge" }))
#end
##[End] Applying Key Condition **
##[End] Set query expression for @key **
#set($limit = $util.defaultIfNull($context.args.limit, 100))
#set($QueryRequest = {
  "version": "2017-02-28",
  "operation": "Query",
  "limit": $limit,
  "query": $modelQueryExpression,
  "index": "${keySpec.name}"
})
#if(!$util.isNull($ctx.args.sortDirection)
  && $ctx.args.sortDirection == "DESC")
  #set($QueryRequest.scanIndexForward = false)
#else
  #set($QueryRequest.scanIndexForward = true)
#end
#if($context.args.nextToken) #set($QueryRequest.nextToken = $context.args.nextToken) #end
#if($context.args.filter) #set($QueryRequest.filter = $util.parseJson("$util.transform.toDynamoDBFilterExpression($ctx.args.filter)")) #end
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
##[Start] Set query expression for @key **
#set($modelQueryExpression = {})
#if(!$util.isNull($ctx.source.${belongingKey}))
  #set($modelQueryExpression.expression = "#${foreignKey} = :${belongingKey}" )
  #set($modelQueryExpression.expressionNames = {
    "#${foreignKey}": "${foreignKey}"
  })
  #set($modelQueryExpression.expressionValues = {
    ":${belongingKey}": {
      "S": "$ctx.source.${belongingKey}"
    }
  })
#end
##[Start] Applying Key Condition **
#set($sortKeyValue = "")
#set($sortKeyValue2 = "")
#if(!$util.isNull($ctx.args.${compositeKey}) && !$util.isNull($ctx.args.${compositeKey}.beginsWith))
  #if(!$util.isNull($ctx.args.${compositeKey}.beginsWith.${
    keySpec.fields[1]
  })) #set($sortKeyValue = "$ctx.args.${compositeKey}.beginsWith.${
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
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND begins_with(#sortKey, :sortKey)")
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields
    .slice(1)
    .join("#")}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$sortKeyValue" }))
#end
#if(!$util.isNull($ctx.args.${compositeKey}) && !$util.isNull($ctx.args.${compositeKey}.between))
  #if($ctx.args.${compositeKey}.between.size() != 2)
    $util.error("Argument ${compositeKey}.between expects exactly 2 elements.")
  #end
  #if(!$util.isNull($ctx.args.${compositeKey}.between[0].${
    keySpec.fields[1]
  })) #set($sortKeyValue = "$ctx.args.${compositeKey}.between[0].${
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
  #if(!$util.isNull($ctx.args.${compositeKey}.between[1].${
    keySpec.fields[1]
  })) #set($sortKeyValue2 = "$ctx.args.${compositeKey}.between[1].${
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
    #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey BETWEEN :sortKey0 AND :sortKey1")
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
##[End] Applying Key Condition **
##[End] Set query expression for @key **
#set($limit = $util.defaultIfNull($context.args.limit, 100))
#set($QueryRequest = {
      "version": "2017-02-28",
      "operation": "Query",
      "limit": $limit,
      "query": $modelQueryExpression,
      "index": "${keySpec.name}"
    })
#if(!$util.isNull($ctx.args.sortDirection)
      && $ctx.args.sortDirection == "DESC")
  #set($QueryRequest.scanIndexForward = false)
#else
  #set($QueryRequest.scanIndexForward = true)
#end
#if($context.args.nextToken) #set($QueryRequest.nextToken = $context.args.nextToken) #end
#if($context.args.filter) #set($QueryRequest.filter = $util.parseJson("$util.transform.toDynamoDBFilterExpression($ctx.args.filter)")) #end
$util.toJson($QueryRequest)
  `;
};

const buildHasManyRes = (target: string) => {
  return `
  ${TableResource.table(target)?.protectListRes()}
$util.toJson($ctx.result)
  `;
};

const buildHasOneRes = (target: string) => {
  return `
  ${TableResource.table(target)?.protectGetRes()}
#if($ctx.error)
  $util.error($ctx.error.message, $ctx.error.type)
#end
#set($res = $ctx.result)
$util.toJson($res)
  `;
};

const buildQueryOperations = (typeName: string, keySpec: KeySpec) => {
  return `
extend type Query {
  ${keySpec.queryField} (${(() => {
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
  })()}, filter: Model${typeName}FilterInput, limit: Int, nextToken: String): Model${typeName}Connection
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
##[Start] Set query expression for @key **
#set($modelQueryExpression = {})
##[Start] Validate key arguments. **
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && $util.isNull($ctx.args.${keySpec.fields[0]}))
$util.error("When providing argument '${keySpec.fields[1]}' you must also provide arguments ${keySpec.fields[0]}", "InvalidArgumentsError")
#end
##[End] Validate key arguments. **
#if(!$util.isNull($ctx.args.${keySpec.fields[0]}))
  #set($modelQueryExpression.expression = "#${keySpec.fields[0]} = :${keySpec.fields[0]}")
  #set($modelQueryExpression.expressionNames = {
  "#${keySpec.fields[0]}": "${keySpec.fields[0]}"
})
  #set($modelQueryExpression.expressionValues = {
  ":yearMonth": {
    "S": "$ctx.args.${keySpec.fields[0]}"
  }
})
#end
##[Start] Applying Key Condition **
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.beginsWith))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND begins_with(#sortKey, :sortKey)")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.beginsWith" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.between))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey BETWEEN :sortKey0 AND :sortKey1")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey0", { "S": "$ctx.args.${keySpec.fields[1]}.between[0]" }))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey1", { "S": "$ctx.args.${keySpec.fields[1]}.between[1]" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.eq))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey = :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.eq" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.lt))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey < :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.lt" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.le))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey <= :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.le" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.gt))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey > :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.gt" }))
#end
#if(!$util.isNull($ctx.args.${keySpec.fields[1]}) && !$util.isNull($ctx.args.${keySpec.fields[1]}.ge))
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey >= :sortKey")
$util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields[1]}"))
$util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$ctx.args.${keySpec.fields[1]}.ge" }))
#end
##[End] Applying Key Condition **
##[End] Set query expression for @key **
#set($limit = $util.defaultIfNull($context.args.limit, 100))
#set($QueryRequest = {
  "version": "2017-02-28",
  "operation": "Query",
  "limit": $limit,
  "query": $modelQueryExpression,
  "index": "${keySpec.name}"
})
#if(!$util.isNull($ctx.args.sortDirection)
  && $ctx.args.sortDirection == "DESC")
  #set($QueryRequest.scanIndexForward = false)
#else
  #set($QueryRequest.scanIndexForward = true)
#end
#if($context.args.nextToken) #set($QueryRequest.nextToken = $context.args.nextToken) #end
#if($context.args.filter) #set($QueryRequest.filter = $util.parseJson("$util.transform.toDynamoDBFilterExpression($ctx.args.filter)")) #end
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
##[Start] Set query expression for @key **
#set($modelQueryExpression = {})
#if(!$util.isNull($ctx.args.${keySpec.fields[0]}))
  #set($modelQueryExpression.expression = "#${keySpec.fields[0]} = :${
    keySpec.fields[0]
  }" )
  #set($modelQueryExpression.expressionNames = {
    "#${keySpec.fields[0]}": "${keySpec.fields[0]}"
  })
  #set($modelQueryExpression.expressionValues = {
    ":${keySpec.fields[0]}": {
      "S": "$ctx.args.${keySpec.fields[0]}"
    }
  })
#end
##[Start] Applying Key Condition **
#set($sortKeyValue = "")
#set($sortKeyValue2 = "")
#if(!$util.isNull($ctx.args.${compositeKey}) && !$util.isNull($ctx.args.${compositeKey}.beginsWith))
  #if(!$util.isNull($ctx.args.${compositeKey}.beginsWith.${
    keySpec.fields[1]
  })) #set($sortKeyValue = "$ctx.args.${compositeKey}.beginsWith.${
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
  #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND begins_with(#sortKey, :sortKey)")
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields
    .slice(1)
    .join("#")}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$sortKeyValue" }))
#end
#if(!$util.isNull($ctx.args.${compositeKey}) && !$util.isNull($ctx.args.${compositeKey}.between))
  #if($ctx.args.${compositeKey}.between.size() != 2)
    $util.error("Argument ${compositeKey}.between expects exactly 2 elements.")
  #end
  #if(!$util.isNull($ctx.args.${compositeKey}.between[0].${
    keySpec.fields[1]
  })) #set($sortKeyValue = "$ctx.args.${compositeKey}.between[0].${
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
  #if(!$util.isNull($ctx.args.${compositeKey}.between[1].${
    keySpec.fields[1]
  })) #set($sortKeyValue2 = "$ctx.args.${compositeKey}.between[1].${
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
    #set($modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey BETWEEN :sortKey0 AND :sortKey1")
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
##[End] Applying Key Condition **
##[End] Set query expression for @key **
#set($limit = $util.defaultIfNull($context.args.limit, 100))
#set($QueryRequest = {
      "version": "2017-02-28",
      "operation": "Query",
      "limit": $limit,
      "query": $modelQueryExpression,
      "index": "${keySpec.name}"
    })
#if(!$util.isNull($ctx.args.sortDirection)
      && $ctx.args.sortDirection == "DESC")
  #set($QueryRequest.scanIndexForward = false)
#else
  #set($QueryRequest.scanIndexForward = true)
#end
#if($context.args.nextToken) #set($QueryRequest.nextToken = $context.args.nextToken) #end
#if($context.args.filter) #set($QueryRequest.filter = $util.parseJson("$util.transform.toDynamoDBFilterExpression($ctx.args.filter)")) #end
$util.toJson($QueryRequest)
  `;
};

const buildQueryListRes = () => {
  return `
$util.toJson($ctx.result)
  `;
};
