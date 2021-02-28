import { ResourceDefinition } from "../interfaces/resource/IResource";
import { Printable } from "../interfaces/resource/Printable";
import { args } from "../io/CliArgs";
import { DiggerUtils } from "../utils/DiggerUtils";
import {
  AuthGroupStrategySpec,
  AuthOwnerStrategySpec,
  AuthSpec,
  AuthUserPoolsSpec,
} from "./TableResource";

export class FunctionResource implements Printable {
  static instances: FunctionResource[] = [];

  private auth: AuthSpec[] = [];

  constructor(
    private functionName: string,
    private typeName: string,
    private fieldName: string
  ) {
    FunctionResource.instances.push(this);
  }

  static function(name: string) {
    return this.instances.find((i) => i.fieldName === name);
  }

  addAuth(auth: AuthSpec) {
    this.auth.push(auth);
  }

  print(): ResourceDefinition[] {
    return [
      {
        location: `resources/appsync/${this.typeName}.${this.fieldName}.mapping.yml`,
        path: "",
        resource: [
          {
            type: this.typeName,
            field: this.fieldName,
            kind: "PIPELINE",
            functions: [this.fieldName],
          },
        ],
      },
      {
        location: `resources/appsync/${this.typeName}.${this.fieldName}.function.yml`,
        path: "",
        resource: [
          {
            dataSource: this.functionName,
            name: this.fieldName,
            request: `Invoke${
              this.fieldName[0].toUpperCase() + this.fieldName.slice(1)
            }.request.vtl`,
            response: `Invoke${
              this.fieldName[0].toUpperCase() + this.fieldName.slice(1)
            }.response.vtl`,
          },
        ],
      },
      {
        location: `mapping-templates/${this.typeName}.${this.fieldName}.request.vtl`,
        path: "",
        resource: buildReq(this.typeName, this.fieldName, this.auth),
      },
      {
        location: `mapping-templates/${this.typeName}.${this.fieldName}.response.vtl`,
        path: "",
        resource: `
$util.toJson($ctx.prev.result)
        `,
      },
      {
        location: `mapping-templates/Invoke${
          this.fieldName[0].toUpperCase() + this.fieldName.slice(1)
        }.request.vtl`,
        path: "",
        resource: `
{
  "version": "2018-05-29",
  "operation": "Invoke",
  "payload": {
      "typeName": "$ctx.stash.get("typeName")",
      "fieldName": "$ctx.stash.get("fieldName")",
      "arguments": $util.toJson($ctx.arguments),
      "identity": $util.toJson($ctx.identity),
      "source": $util.toJson($ctx.source),
      "request": $util.toJson($ctx.request),
      "prev": $util.toJson($ctx.prev)
  }
}
## [End] Invoke AWS Lambda data source. **
        
        `,
      },
      {
        location: `mapping-templates/Invoke${
          this.fieldName[0].toUpperCase() + this.fieldName.slice(1)
        }.response.vtl`,
        path: "",
        resource: `
## [Start] Handle error or return result. **
#if( $ctx.error )
  $util.error($ctx.error.message, $ctx.error.type)
#end
$util.toJson($ctx.result)
## [End] Handle error or return result. **
        `,
      },
      {
        location: `schema/${args["in-schema"]}`,
        path: DiggerUtils.removeFieldDirective(
          this.typeName,
          this.fieldName,
          "function"
        ),
        resource: {},
      },
      {
        location: `schema/${args["in-schema"]}`,
        path: DiggerUtils.removeFieldDirective(
          this.typeName,
          this.fieldName,
          "auth"
        ),
        resource: {},
      },
      ...authSpecToAppSyncDirective(this.auth).map((auth) => ({
        location: `schema/${args["in-schema"]}`,
        path: DiggerUtils.addFieldDirective(
          this.typeName,
          this.fieldName,
          auth
        ),
        resource: {},
      })),
    ];
  }
}

class InvalidStateException {
  constructor(_: never) {}
}

const authSpecToAppSyncDirective = (authSpecs: AuthSpec[]) =>
  authSpecs
    .map((elem) =>
      (() => {
        const provider = elem.provider;
        switch (provider) {
          case "AMAZON_COGNITO_USER_POOLS":
            return "aws_cognito_user_pools";
          case "AWS_IAM":
            return "aws_iam";
          case "API_KEY":
            return "api_key";
          default:
            throw new InvalidStateException(provider);
        }
      })()
    )
    .filter((a, b, c) => c.indexOf(a) === b);

const buildReq = (type: string, field: string, authSpecs: AuthSpec[]) => {
  switch (type) {
    case "Mutation":
      const req = `
        ## [Start] Stash resolver specific context.. **
$util.qr($ctx.stash.put("typeName", "Mutation"))
$util.qr($ctx.stash.put("fieldName", "${field}"))
## Automatically set the updatedAt timestamp. **
$util.qr($context.args.input.put("updatedAt", $util.defaultIfNull($ctx.args.input.updatedAt, $util.time.nowISO8601())))
{
  "value": $util.toJson($ctx.args.input)
}
## [End] Stash resolver specific context.. **
      `;
      return addAuthToMutationReq(authSpecs, req);
    case "Query":
    default:
      return `
        ## [Start] Stash resolver specific context.. **
$util.qr($ctx.stash.put("typeName", "Query"))
$util.qr($ctx.stash.put("fieldName", "${field}"))
{}
## [End] Stash resolver specific context.. **
      `;
  }
};

const addAuthToMutationReq = (authSpecs: AuthSpec[], template: string) => {
  const relatedAuth = authSpecs.filter(
    (a) => a.provider === "AMAZON_COGNITO_USER_POOLS"
  );
  if (relatedAuth.length === 0) {
    return template;
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
  #set( $allowedOwners${index} = $ctx.args.input.${strategy.ownerField} )
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
  #if(!($isStaticGroupAuthorized == true || $isDynamicGroupAuthorized == true || $isOwnerAuthorized == true) )
    $util.unauthorized()
  #end
  ## [End] Throw if unauthorized **
#end
## [End] Check authMode and execute owner/group checks **

${template}

`;
};
