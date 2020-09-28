import { TypeSystemDefinitionNode } from "graphql";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { DirectiveArg, IDirective } from "../../interfaces/directive/Directive";
import { typeMatch } from "../../io/CliArgs";
import { TableResource } from "../../resources/TableResource";

const NAME = "model";
export class ModelDirective implements IDirective {
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
    new TableResource(node.name.value, "DYNAMODB", node, context.getRoot()) // automatically register
  }
}
