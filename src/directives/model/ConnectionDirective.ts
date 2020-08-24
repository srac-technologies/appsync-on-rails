import {
  ASTNode,
  FieldDefinitionNode,
  TypeDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  StringValueNode,
} from "graphql";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { DirectiveArg, IDirective } from "../../interfaces/directive/Directive";
import { IResource } from "../../interfaces/resource/IResource";
import { DynamoDBIndexResource } from "../../resources/DynamoDBIndexResource";
import {
  GraphqlConnectionResource,
  GraphqlConnectedInputResource,
} from "../../resources/GraphqlConnectionResource";
import { typeMatch } from "../../io/CliArgs";

const NAME = "connection";
export class ConnectionDirective implements IDirective {
  replaceInputAsKey(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ) {
    const type = <InputObjectTypeDefinitionNode>context.parent().node;
    return [
      new GraphqlConnectedInputResource(
        (<StringValueNode>(
          (
            (type.directives || []).find((d) => d.name.value === "modelInput")
              ?.arguments || []
          ).find((a) => a.name.value === "name")?.value
        )).value || "",
        type,
        <InputValueDefinitionNode>node,
        {
          name: args.find((a) => a.name === "name")?.value || "",
          type: ((n) => {
            switch (n.type.kind) {
              case "ListType":
                return "HAS_MANY";
              case "NonNullType":
                return n.type.type.kind === "ListType" ? "HAS_MANY" : "HAS_ONE";
              case "NamedType":
                return "HAS_ONE";
            }
          })(<InputValueDefinitionNode>node),
          relationSpec: {
            field: (<InputValueDefinitionNode>node).name.value,
            type: getType(<InputValueDefinitionNode>node).value,
            keyName: {
              mine: (args.find((a) => a.name === "myKey") || { value: "id" })
                .value,
              yours: (args.find((a) => a.name === "yourKey") || { value: "id" })
                .value,
            },
          },
        },
        !!(
          (type.directives || []).find((d) => d.name.value === "modelInput")
            ?.arguments || []
        ).find((a) => a.name.value === "condition")
      ),
    ];
  }

  next(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ): false | IResource[] {
    if (name !== NAME || !typeMatch(context)) {
      return false;
    }
    if (node.kind === "InputValueDefinition") {
      return this.replaceInputAsKey(name, args, node, context);
    }
    if (node.kind !== "FieldDefinition") {
      return false;
    }
    const parent = <TypeDefinitionNode>context.parent().node;
    return [
      new GraphqlConnectionResource(
        parent.name.value,
        {
          name: args.find((a) => a.name === "name")?.value || "",
          type: ((n) => {
            switch (n.type.kind) {
              case "ListType":
                return "HAS_MANY";
              case "NonNullType":
                return n.type.type.kind === "ListType" ? "HAS_MANY" : "HAS_ONE";
              case "NamedType":
                return "HAS_ONE";
            }
          })(node),
          relationSpec: {
            field: node.name.value,
            type: getType(node).value,
            keyName: {
              mine: (args.find((a) => a.name === "myKey") || { value: "id" })
                .value,
              yours: (args.find((a) => a.name === "yourKey") || { value: "id" })
                .value,
            },
          },
        },
        node
      ),
      ...args
        .filter((a) => a.name === "myKey")
        .filter((a) => a.value !== "id")
        .map(
          (a) =>
            new DynamoDBIndexResource(parent.name.value, {
              fields: [a.value],
              name: args.find((a) => a.name === "name")?.value || "",
            })
        ),
    ];
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
