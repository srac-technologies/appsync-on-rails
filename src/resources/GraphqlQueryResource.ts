
import {
    IResource,
    ResourceDefinition
} from "../interfaces/resource/IResource";
import { KeySpec } from "./DynamoDBIndexResource";
import { DocumentNode, ObjectTypeDefinitionNode } from "graphql";

export class GraphqlQueryResource implements IResource {
    constructor(
        private tableName: string,
        private keySpec: KeySpec
    ) { }
    outputResourceDefinition(): ResourceDefinition[] {
        if (!this.keySpec.name || !this.keySpec.queryField) {
            return []
        }
        return [
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
                                            (d) => d.name.value !== "key"
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
            {
                location: `resources/appsync/${this.tableName}.${this.keySpec.queryField}.mapping.yml`,
                path: "",
                resource: [
                    {
                        dataSource: this.tableName,
                        type: "Query",
                        field: this.keySpec.queryField,
                    },
                ],
            },
            {
                location: `mapping-templates/Query.${this.keySpec.queryField}.request.vtl`,
                path: "",
                resource: buildListReq(this.keySpec),
            },
            {
                location: `mapping-templates/Query.${this.keySpec.queryField}s.response.vtl`,
                path: "",
                resource: buildListRes(),
            },
            {
                location: `schema/${this.tableName}.${this.keySpec.queryField}.graphql`,
                path: "",
                resource: buildOperations(
                    this.tableName,
                    this.keySpec
                ),
            },
        ];
    }
}


const buildOperations = (
    typeName: string,
    keySpec: KeySpec
) => {
    return `
 extend type Query {
  ${keySpec.queryField}(${(() => {
            if (keySpec.fields.length === 1) {
                return `${keySpec.fields[0]}: String`
            }
            if (keySpec.fields.length === 2) {
                return `${keySpec.fields[0]}: String,  ${keySpec.fields[1]}: ModelStringConditionInput`
            }
            return `${keySpec.fields[0]}: String,  ${keySpec.fields[1]}${keySpec.fields.slice(2).map(f => f[0].toUpperCase() + f.slice(1)).join('')}: Model${typeName}${keySpec.name}CompositeKeyConditionInput`
        })()
        },  filter: Model${typeName}FilterInput, limit: Int, nextToken: String): Model${typeName}Connection 
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
  ${keySpec.fields.slice(1).map(f => `${f}: String`).join('\n')}
}
`;
};


const buildListReq = (keySpec: KeySpec) => {
    if (keySpec.fields.length === 2) {
        return ''
    }
    if (keySpec.fields.length > 2) {
        const compositeKey = keySpec.fields[1] + keySpec.fields.slice(2).map(f => f[0].toUpperCase() + f.slice(1)).join('')
        return `
## [Start] Set query expression for @key **
#set( $modelQueryExpression = {} )
#if( !$util.isNull($ctx.args.${keySpec.fields[0]}) )
  #set( $modelQueryExpression.expression = "#${keySpec.fields[0]} = :${keySpec.fields[0]}" )
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
  #if( !$util.isNull($ctx.args.${compositeKey}.beginsWith.${keySpec.fields[1]}) ) #set( $sortKeyValue = "$ctx.args.${compositeKey}.beginsWith.${keySpec.fields[1]}" ) #end
  ${keySpec.fields.slice(1).map(f => `
  #if( !$util.isNull($ctx.args.${compositeKey}.beginsWith.${f}) ) #set( $sortKeyValue = "$sortKeyValue#$ctx.args.${compositeKey}.beginsWith.${f}" ) #end
  `).join('\n')}
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND begins_with(#sortKey, :sortKey)" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields.slice(1).join('#')}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$sortKeyValue" }))
#end

#if( !$util.isNull($ctx.args.${compositeKey}) && !$util.isNull($ctx.args.${compositeKey}.between) )
  #if( $ctx.args.${compositeKey}.between.size() != 2 )
    $util.error("Argument ${compositeKey}.between expects exactly 2 elements.")
  #end
  #if( !$util.isNull($ctx.args.${compositeKey}.between[0].${keySpec.fields[1]}) ) #set( $sortKeyValue = "$ctx.args.${compositeKey}.between[0].${keySpec.fields[1]}" ) #end
  ${keySpec.fields.slice(1).map(f => `
  #if( !$util.isNull($ctx.args.${compositeKey}.between[0].${f}) ) #set( $sortKeyValue = "$sortKeyValue#$ctx.args.${compositeKey}.between[0].${f}" ) #end
  `).join('\n')}
  #if( !$util.isNull($ctx.args.${compositeKey}.between[1].${keySpec.fields[1]}) ) #set( $sortKeyValue2 = "$ctx.args.${compositeKey}.between[1].${keySpec.fields[1]}" ) #end
  ${keySpec.fields.slice(1).map(f => `
  #if( !$util.isNull($ctx.args.${compositeKey}.between[1].${f}) ) #set( $sortKeyValue2 = "$sortKeyValue2#$ctx.args.${compositeKey}.between[1].${f}" ) #end
  `).join('\n')}
    #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey BETWEEN :sortKey0 AND :sortKey1" )
    $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields.slice(1).join('#')}"))
    $util.qr($modelQueryExpression.expressionValues.put(":sortKey0", { "S": "$sortKeyValue" }))
    $util.qr($modelQueryExpression.expressionValues.put(":sortKey1", { "S": "$sortKeyValue2" }))
#end
${
            ['eq', 'lt', 'gt', 'le', 'ge'].map(operator => `
#if( !$util.isNull($ctx.args.${compositeKey}) && !$util.isNull($ctx.args.${compositeKey}.${operator}) )
  #if( !$util.isNull($ctx.args.${compositeKey}.${operator}.${keySpec.fields[1]}) ) #set( $sortKeyValue = "$ctx.args.${compositeKey}.${operator}.${keySpec.fields[1]}" ) #end
  ${keySpec.fields.slice(1).map(f => `
  #if( !$util.isNull($ctx.args.${compositeKey}.${operator}.${f}) ) #set( $sortKeyValue = "$sortKeyValue#$ctx.args.${compositeKey}.${operator}.${f}" ) #end
  `).join('\n')}
  #set( $modelQueryExpression.expression = "$modelQueryExpression.expression AND #sortKey ${(() => {
                    switch (operator) {
                        case 'eq':
                            return '='
                        case 'lt':
                            return '<'
                        case 'le':
                            return '<=';
                        case 'gt':
                            return '>'
                        case 'ge':
                            return '>='
                    }
                })()} :sortKey" )
  $util.qr($modelQueryExpression.expressionNames.put("#sortKey", "${keySpec.fields.slice(1).join('#')}"))
  $util.qr($modelQueryExpression.expressionValues.put(":sortKey", { "S": "$sortKeyValue" }))
#end
  `)
            }


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
};

const buildListRes = () => {
    return `
$util.toJson($ctx.result)
    `;
};




