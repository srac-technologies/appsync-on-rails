import {
  IResource,
  ResourceDefinition,
} from "../interfaces/resource/IResource";
import {
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  DocumentNode,
  ObjectTypeDefinitionNode,
  FieldDefinitionNode,
} from "graphql";
import { args } from "../io/CliArgs";
import { type } from "os";

export type GraphqlConnectionSpec = {
  name: string;
  type: "HAS_MANY" | "BELONGS_TO" | "HAS_ONE";
  relationSpec: {
    field: string;
    type: string;
    keyName: {
      mine: string;
      yours: string;
    };
  };
};

export class GraphqlConnectedInputResource implements IResource {
  constructor(
    private tableName: string,
    private typeNode: InputObjectTypeDefinitionNode,
    private fieldNode: InputValueDefinitionNode,
    private spec: GraphqlConnectionSpec,
    private condition: boolean
  ) {}

  outputResourceDefinition(): ResourceDefinition[] {
    if (
      !this.spec.relationSpec.keyName.mine ||
      this.spec.relationSpec.keyName.mine === "id"
    ) {
      return [
        {
          location: `schema/${this.tableName}.graphql`,
          path: (from: DocumentNode) => {
            return (value: any) => {
              const t = <InputObjectTypeDefinitionNode>(
                from.definitions.find(
                  (d) =>
                    d.kind === "InputObjectTypeDefinition" &&
                    d.name.value === this.typeNode.name.value
                )
              );
              if (t) {
                return {
                  ...from,
                  definitions: [
                    ...from.definitions.filter(
                      (d) =>
                        !(
                          d.kind === "InputObjectTypeDefinition" &&
                          d.name.value === this.typeNode.name.value
                        )
                    ),
                    <InputObjectTypeDefinitionNode>{
                      ...t,
                      kind: "InputObjectTypeDefinition",
                      fields: [
                        ...(t.fields || []).filter(
                          (f) => f.name.value !== this.fieldNode.name.value
                        ),
                      ],
                    },
                  ],
                };
              }
              return from;
            };
          },
          resource: null,
        },
      ];
    }

    return [
      {
        location: `schema/${this.tableName}.graphql`,
        path: (from: DocumentNode) => {
          return (value: any) => {
            const t = <InputObjectTypeDefinitionNode>(
              from.definitions.find(
                (d) =>
                  d.kind === "InputObjectTypeDefinition" &&
                  d.name.value === this.typeNode.name.value
              )
            );
            if (t) {
              return {
                ...from,
                definitions: [
                  ...from.definitions.filter(
                    (d) =>
                      !(
                        d.kind === "InputObjectTypeDefinition" &&
                        d.name.value === this.typeNode.name.value
                      )
                  ),
                  <InputObjectTypeDefinitionNode>{
                    ...t,
                    kind: "InputObjectTypeDefinition",
                    fields: [
                      ...(t.fields || []).filter(
                        (f) => f.name.value !== this.fieldNode.name.value
                      ),
                      value,
                    ],
                  },
                ],
              };
            }
            return from;
          };
        },
        resource: <InputValueDefinitionNode>{
          ...this.fieldNode,
          directives: [
            ...(this.fieldNode.directives || []).filter(
              (d) => d.name.value !== "connection"
            ),
          ],
          name: {
            kind: "Name",
            value: this.spec.relationSpec.keyName.mine,
          },
          type: {
            kind: "NamedType",
            name: {
              kind: "Name",
              value: this.condition ? `ModelStringInput` : "String",
            },
          },
        },
      },
    ];
  }
}

const buildListFieldNode = (
  fieldNode: FieldDefinitionNode
): FieldDefinitionNode => {
  // (filter: ModelEmployeeFilterInput, sortDirection: ModelSortDirection, limit: Int, nextToken: String)
  switch (fieldNode.type.kind) {
    case "ListType":
      const typeName =
        fieldNode.type.type.kind === "NamedType"
          ? fieldNode.type.type.name.value
          : "";
      return {
        ...fieldNode,
        arguments: [
          <InputValueDefinitionNode>{
            kind: "InputValueDefinition",
            name: {
              kind: "Name",
              value: "filter",
            },
            type: {
              kind: "NamedType",
              name: {
                kind: "Name",
                value: `Model${typeName}FilterInput`,
              },
            },
          },
          <InputValueDefinitionNode>{
            kind: "InputValueDefinition",
            name: {
              kind: "Name",
              value: "sortDirection",
            },
            type: {
              kind: "NamedType",
              name: {
                kind: "Name",
                value: `ModelSortDirection`,
              },
            },
          },
          <InputValueDefinitionNode>{
            kind: "InputValueDefinition",
            name: {
              kind: "Name",
              value: "limit",
            },
            type: {
              kind: "NamedType",
              name: {
                kind: "Name",
                value: `Int`,
              },
            },
          },
          <InputValueDefinitionNode>{
            kind: "InputValueDefinition",
            name: {
              kind: "Name",
              value: "nextToken",
            },
            type: {
              kind: "NamedType",
              name: {
                kind: "Name",
                value: `String`,
              },
            },
          },
        ],
        type: {
          kind: "NamedType",
          name: {
            kind: "Name",
            value: `Model${typeName}Connection`,
          },
        },
        directives: [
          ...(fieldNode.directives || []).filter(
            (f) => f.name.value !== "connection"
          ),
        ],
      };
    case "NamedType":
      return {
        ...fieldNode,
        directives: [
          ...(fieldNode.directives || []).filter(
            (f) => f.name.value !== "connection"
          ),
        ],
      };
    case "NonNullType":
      return {
        ...fieldNode,
        directives: [
          ...(fieldNode.directives || []).filter(
            (f) => f.name.value !== "connection"
          ),
        ],
      };
  }
};
export class GraphqlConnectionResource implements IResource {
  constructor(
    private tableName: string,
    private graphqlConnectionSpec: GraphqlConnectionSpec,
    private fieldNode: FieldDefinitionNode
  ) {}

  outputResourceDefinition(): ResourceDefinition[] {
    return [
      {
        location: `schema/${args["in-schema"]}`,
        resource: buildListFieldNode(this.fieldNode),
        path: (from: DocumentNode) => {
          return (value: any) => {
            const t = <ObjectTypeDefinitionNode>(
              from.definitions.find(
                (d) =>
                  d.kind === "ObjectTypeDefinition" &&
                  d.name.value === this.tableName
              )
            );
            if (t) {
              return {
                ...from,
                definitions: [
                  ...from.definitions.filter(
                    (d) =>
                      !(
                        d.kind === "ObjectTypeDefinition" &&
                        d.name.value === this.tableName
                      )
                  ),
                  <ObjectTypeDefinitionNode>{
                    ...t,
                    kind: "ObjectTypeDefinition",
                    fields: [
                      ...(t.fields || []).filter(
                        (f) =>
                          f.name.value !==
                          this.graphqlConnectionSpec.relationSpec.field
                      ),
                      value,
                    ],
                  },
                ],
              };
            }
            return from;
          };
        },
      },
      {
        location: `resources/appsync/${this.tableName}.${this.graphqlConnectionSpec.relationSpec.field}.mapping.yml`,
        path: "",
        resource: [
          {
            dataSource: this.graphqlConnectionSpec.relationSpec.type,
            type: this.tableName,
            field: this.graphqlConnectionSpec.relationSpec.field,
          },
        ],
      },
      {
        location: `mapping-templates/${this.tableName}.${this.graphqlConnectionSpec.relationSpec.field}.request.vtl`,
        path: "",
        resource:
          this.graphqlConnectionSpec.type === "HAS_MANY"
            ? buildHasMany(
                this.graphqlConnectionSpec.relationSpec.keyName.yours,
                this.graphqlConnectionSpec.relationSpec.keyName.mine,
                this.graphqlConnectionSpec.name
              )[0]
            : buildHasOne(
                this.graphqlConnectionSpec.relationSpec.keyName.yours,
                this.graphqlConnectionSpec.relationSpec.keyName.mine
              )[0],
      },
      {
        location: `mapping-templates/${this.tableName}.${this.graphqlConnectionSpec.relationSpec.field}.response.vtl`,
        path: "",
        resource:
          this.graphqlConnectionSpec.type === "HAS_MANY"
            ? buildHasMany(
                this.graphqlConnectionSpec.relationSpec.keyName.yours,
                this.graphqlConnectionSpec.relationSpec.keyName.mine,
                this.graphqlConnectionSpec.name
              )[1]
            : buildHasOne(
                this.graphqlConnectionSpec.relationSpec.keyName.yours,
                this.graphqlConnectionSpec.relationSpec.keyName.mine
              )[1],
      },
    ];
  }
}

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
