import { TypeSystemDefinitionNode } from "graphql";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { DirectiveArg, IDirective } from "../../interfaces/directive/Directive";
import { typeMatch } from "../../io/CliArgs";
import { TableResource } from "../../resources/TableResource";

const NAME = "key";
export class KeyDirective implements IDirective {
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
        const keySpec = {
            fields: args.find(a => a.name === 'fields')?.value as [string, ...string[]],
            name: args.find(a => a.name === 'name')?.value as string,
            queryField: args.find(a => a.name === 'queryField')?.value as string,
        }

        TableResource.table(node.name.value)?.addKey(keySpec)
    }
}
