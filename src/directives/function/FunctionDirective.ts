import { ASTNode, TypeDefinitionNode } from "graphql";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { DirectiveArg, IDirective } from "../../interfaces/directive/Directive";
import { typeMatch } from "../../io/CliArgs";
import { FunctionResource } from "../../resources/FunctionResource";

const NAME = "function";
export class FunctionDirective implements IDirective {
  next(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ) {
    if (
      name !== NAME ||
      node.kind !== "FieldDefinition" ||
      !typeMatch(context)
    ) {
      return false;
    }
    const parent = <TypeDefinitionNode>context.parent().node;
    new FunctionResource(
      args.find((a) => a.name === "name")?.value as string || "",
      parent.name.value,
      node.name.value
    )
  }
}
