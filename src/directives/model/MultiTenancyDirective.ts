import { IDirective, DirectiveArg } from "../../interfaces/directive/Directive";
import { TypeSystemDefinitionNode } from "graphql";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { TableResource } from "../../resources/TableResource";
import { typeMatch } from "../../io/CliArgs";

const NAME = "multiTenancy";
export class MultiTenancyDirective implements IDirective {
    next(
        name: string,
        args: DirectiveArg[],
        node: TypeSystemDefinitionNode,
        context: TransformContext
    ) {
        if (
            name !== NAME ||
            node.kind !== "ObjectTypeDefinition" ||
            !typeMatch(context)
        ) {
            return false;
        }
        const spec = {
            field: args.find(a => a.name === 'field')?.value as string ?? 'tenantId',
            indexSuffix: args.find(a => a.name === 'indexSuffix')?.value as string ?? 'MT',
            ownerField: args.find(a => a.name === 'ownerField')?.value as string ?? 'custom:tenantId',
        }

        TableResource.table(node.name.value)?.setMultiTenancy(spec)
    }
}
