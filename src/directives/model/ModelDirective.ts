import { IDirective, DirectiveArg } from "../../interfaces/directive/Directive";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { IResource } from "../../interfaces/resource/IResource";
import { TypeSystemDefinitionNode } from "graphql";
import { DynamoDBTableResource } from "../../resources/DynamoDBTableResource";
import { GraphqlCrudResource } from "../../resources/GraphqlCrudResource";
import { typeMatch } from "../../io/CliArgs";

const NAME = "model";
export class ModelDirective implements IDirective {
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
    return [
      new DynamoDBTableResource(node.name.value),
      new GraphqlCrudResource(node.name.value, "id", node),
    ];
  }
}
