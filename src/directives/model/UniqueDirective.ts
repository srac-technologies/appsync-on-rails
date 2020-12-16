import {
  ASTNode,
  FieldDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  TypeDefinitionNode,
} from "graphql";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { DirectiveArg, IDirective } from "../../interfaces/directive/Directive";
import { typeMatch } from "../../io/CliArgs";
import { TableResource } from "../../resources/TableResource";

const NAME = "unique";
export class UniqueDirective implements IDirective {
  next(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ) {
    if (name !== NAME || !typeMatch(context)) {
      return false;
    }
    if (node.kind !== "FieldDefinition") {
      return false;
    }
    const parent = <TypeDefinitionNode>context.parent().node;
    TableResource.table(parent.name.value)?.hasUnique(node.name.value);
  }
}
