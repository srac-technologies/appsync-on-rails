import { ASTNode, TypeDefinitionNode } from "graphql";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { DirectiveArg, IDirective } from "../../interfaces/directive/Directive";
import { IResource } from "../../interfaces/resource/IResource";
import { FunctionResource } from "../../resources/FunctionResource";
import { args, typeMatch } from "../../io/CliArgs";

const NAME = "function";
export class FunctionDirective implements IDirective {
  next(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ): false | IResource[] {
    if (
      name !== NAME ||
      node.kind !== "FieldDefinition" ||
      !typeMatch(context)
    ) {
      return false;
    }
    const parent = <TypeDefinitionNode>context.parent().node;
    return [
      new FunctionResource(
        args.find((a) => a.name === "name")?.value || "",
        parent.name.value,
        node.name.value
      ),
    ];
  }
}
