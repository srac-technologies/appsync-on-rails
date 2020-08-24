import {
  ObjectTypeDefinitionNode,
  print,
  Kind,
  FieldDefinitionNode,
  InputValueDefinitionNode,
  DocumentNode,
  InputObjectTypeDefinitionNode,
} from "graphql";
import {
  IResource,
  ResourceDefinition,
} from "../interfaces/resource/IResource";
import { args } from "../io/CliArgs";

export class GraphqlCrudResource implements IResource {
  constructor(
    private tableName: string,
    private primaryKey: string = "id",
    private typeNode: ObjectTypeDefinitionNode
  ) { }
  outputResourceDefinition(): ResourceDefinition[] {
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
        resource: buildCreateReq(this.tableName, this.primaryKey),
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
          this.typeNode
        ),
      },
      {
        location: `schema/schema.graphql`,
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
                    directives: (t.directives || []).filter(
                      (d) => d.name.value !== "model"
                    ),
                  },
                ],
              };
            }
            return from;
          };
        },
        resource: {},
      },
    ];
  }
}

const makeTypeModelInput = (
  f: FieldDefinitionNode
): InputValueDefinitionNode => {
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


const buildCrudOperations = (
  typeName: string,
  keyName: string,
  typeNode: ObjectTypeDefinitionNode
) => {
  return `
 extend type Query {
  get${typeName}(${keyName}: ID!): ${typeName} 
  list${typeName}s(filter: Model${typeName}FilterInput, limit: Int, nextToken: String): Model${typeName}Connetion 
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
      ...(typeNode.fields || []).map((f) => makeTypeModelInput(f)),
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
    directives: [
      {
        kind: "Directive",
        name: {
          kind: "Name",
          value: "modelInput",
        },
        arguments: [
          {
            kind: "Argument",
            name: {
              kind: "Name",
              value: "name",
            },
            value: {
              kind: "StringValue",
              value: typeName,
            },
          },
          {
            kind: "Argument",
            name: {
              kind: "Name",
              value: "condition",
            },
            value: {
              kind: "BooleanValue",
              value: true,
            },
          },
        ],
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
      ...(typeNode.fields || []).map((f) => makeTypeModelInput(f)),
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
    directives: [
      {
        kind: "Directive",
        name: {
          kind: "Name",
          value: "modelInput",
        },
        arguments: [
          {
            kind: "Argument",
            name: {
              kind: "Name",
              value: "name",
            },
            value: {
              kind: "StringValue",
              value: typeName,
            },
          },
          {
            kind: "Argument",
            name: {
              kind: "Name",
              value: "condition",
            },
            value: {
              kind: "BooleanValue",
              value: true,
            },
          },
        ],
      },
    ],
  })}
 ${print({
    kind: "InputObjectTypeDefinition",
    name: {
      kind: "Name",
      value: `Create${typeName}Input`,
    },
    fields: typeNode.fields?.map((f) => ({
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
    })),
    directives: [
      {
        kind: "Directive",
        name: {
          kind: "Name",
          value: "modelInput",
        },
        arguments: [
          {
            kind: "Argument",
            name: {
              kind: "Name",
              value: "name",
            },
            value: {
              kind: "StringValue",
              value: typeName,
            },
          },
        ],
      },
    ],
  })}
 ${print({
    kind: "InputObjectTypeDefinition",
    name: {
      kind: "Name",
      value: `Update${typeName}Input`,
    },
    fields: typeNode.fields?.map((f) => ({
      ...f,
      kind: "InputValueDefinition",
    })),
    directives: [
      {
        kind: "Directive",
        name: {
          kind: "Name",
          value: "modelInput",
        },
        arguments: [
          {
            kind: "Argument",
            name: {
              kind: "Name",
              value: "name",
            },
            value: {
              kind: "StringValue",
              value: typeName,
            },
          },
        ],
      },
    ],
  })}
 input Delete${typeName}Input {
   ${keyName}: ID!
 }
 `;
};

const buildGetReq = (keyName: string) => {
  return `
{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": #if( $modelObjectKey ) $util.toJson($modelObjectKey) #else {
  "${keyName}": $util.dynamodb.toDynamoDBJson($ctx.args.${keyName})
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

const buildCreateReq = (tableName: string, keyName: string) => {
  return `
## [Start] Prepare DynamoDB PutItem Request. **
#set( $createdAt = $util.time.nowISO8601() )
## Automatically set the createdAt timestamp. **
$util.qr($context.args.input.put("createdAt", $util.defaultIfNull($ctx.args.input.createdAt, $createdAt)))
## Automatically set the updatedAt timestamp. **
$util.qr($context.args.input.put("updatedAt", $util.defaultIfNull($ctx.args.input.updatedAt, $createdAt)))
$util.qr($context.args.input.put("__typename", "${tableName}"))
#set( $condition = {
  "expression": "attribute_not_exists(#id)",
  "expressionNames": {
      "#id": "${keyName}"
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
  "id":   $util.dynamodb.toDynamoDBJson($util.defaultIfNullOrBlank($ctx.args.input.${keyName}, $util.autoId()))
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

const buildUpdateReq = (typeName: string, keyName: string) => {
  return `
#if( $authCondition && $authCondition.expression != "" )
  #set( $condition = $authCondition )
  #if( $modelObjectKey )
    #foreach( $entry in $modelObjectKey.entrySet() )
      $util.qr($condition.put("expression", "$condition.expression AND attribute_exists(#keyCondition$velocityCount)"))
      $util.qr($condition.expressionNames.put("#keyCondition$velocityCount", "$entry.key"))
    #end
  #else
    $util.qr($condition.put("expression", "$condition.expression AND attribute_exists(#id)"))
    $util.qr($condition.expressionNames.put("#id", "${keyName}"))
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
  "expression": "attribute_exists(#id)",
  "expressionNames": {
      "#id": "${keyName}"
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
  #set( $keyFields = ["id"] )
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
  "${keyName}": {
      "S": $util.toJson($context.args.input.${keyName})
  }
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

const buildDeleteReq = (typeName: string, keyName: string) => {
  return `
#if( $authCondition )
  #set( $condition = $authCondition )
  #if( $modelObjectKey )
    #foreach( $entry in $modelObjectKey.entrySet() )
      $util.qr($condition.put("expression", "$condition.expression AND attribute_exists(#keyCondition$velocityCount)"))
      $util.qr($condition.expressionNames.put("#keyCondition$velocityCount", "$entry.key"))
    #end
  #else
    $util.qr($condition.put("expression", "$condition.expression AND attribute_exists(#id)"))
    $util.qr($condition.expressionNames.put("#id", "id"))
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
  "expression": "attribute_exists(#id)",
  "expressionNames": {
      "#id": "${keyName}"
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
  "${keyName}": $util.dynamodb.toDynamoDBJson($ctx.args.input.${keyName})
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
