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

const NAME = "connection";
export class ConnectionDirective implements IDirective {
  replaceInputAsKey(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ) {
    const type = <InputObjectTypeDefinitionNode>context.parent().node;
  }

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
    TableResource.table(parent.name.value)?.hasConnection({
      hasMany:
        node.type.kind === "ListType" ||
        (node.type.kind === "NonNullType" &&
          node.type.type.kind === "ListType"),
      name: (args.find((a) => a.name === "name")?.value as string) || "",
      with: getType(node).value,
      foreignKey:
        (args.find((a) => a.name === "foreignKey")?.value as string) ||
        undefined,
      node: node,
    });
  }
}

const getType = (node: FieldDefinitionNode | InputValueDefinitionNode) => {
  switch (node.type.kind) {
    case "ListType":
      switch (node.type.type.kind) {
        case "NamedType":
          return node.type.type.name;
        default:
          throw new Error("node unknown state");
      }
    case "NamedType":
      return node.type.name;
    case "NonNullType":
      switch (node.type.type.kind) {
        case "ListType":
          switch (node.type.type.type.kind) {
            case "NamedType":
              return node.type.type.type.name;
            default:
              throw new Error("node unknown state");
          }
        case "NamedType":
          return node.type.type.name;
      }
  }
};
