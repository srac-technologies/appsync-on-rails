import { ResourceDefinition } from "../interfaces/resource/IResource";
import { Printable } from "../interfaces/resource/Printable";
import { args } from "../io/CliArgs";
import { DiggerUtils } from "../utils/DiggerUtils";

export class FunctionResource implements Printable {
  static instances: FunctionResource[] = [];

  constructor(
    private functionName: string,
    private typeName: string,
    private fieldName: string
  ) {
    FunctionResource.instances.push(this);
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
        resource: buildReq(this.typeName, this.fieldName),
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
    ];
  }
}

const buildReq = (type: string, field: string) => {
  switch (type) {
    case "Mutation":
      return `
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
