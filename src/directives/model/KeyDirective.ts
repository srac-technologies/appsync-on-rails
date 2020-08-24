import { TypeSystemDefinitionNode } from "graphql";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { DirectiveArg, IDirective } from "../../interfaces/directive/Directive";
import { IResource } from "../../interfaces/resource/IResource";
import { typeMatch } from "../../io/CliArgs";
import { DynamoDBIndexResource } from "../../resources/DynamoDBIndexResource";
import { GraphqlQueryResource } from "../../resources/GraphqlQueryResource";

const NAME = "key";
export class KeyDirective implements IDirective {
    next(
        name: string,
        args: DirectiveArg[],
        node: TypeSystemDefinitionNode,
        context: TransformContext
    ): false | IResource[] {
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
        return [
            new DynamoDBIndexResource(node.name.value, keySpec),
            new GraphqlQueryResource(node.name.value, keySpec)
        ];
    }
}
