import {
  IResource,
  ResourceDefinition,
} from "../interfaces/resource/IResource";

export class FunctionResource implements IResource {
  constructor(
    private functionName: string,
    private typeName: string,
    private fieldName: string
  ) {}
  outputResourceDefinition(): ResourceDefinition[] {
    return [
      {
        location: `resources/appsync/${this.typeName}.${this.fieldName}.mapping.yml`,
        path: "",
        resource: [
          {
            dataSource: this.functionName,
            type: this.typeName,
            field: this.fieldName,
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
