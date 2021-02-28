import {
  ASTNode,
  FieldDefinitionNode,
  TypeSystemDefinitionNode,
} from "graphql";
import { TransformContext } from "../../interfaces/context/TransformContext";
import { DirectiveArg, IDirective } from "../../interfaces/directive/Directive";
import { typeMatch } from "../../io/CliArgs";
import { FunctionResource } from "../../resources/FunctionResource";
import { TableResource, AuthSpec } from "../../resources/TableResource";

const NAME = "auth";
export class AuthDirective implements IDirective {
  next(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ) {
    this.nextWithTable(name, args, node, context) ||
      this.nextWithField(name, args, node, context);
  }

  nextWithTable(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ) {
    if (
      name !== NAME ||
      node.kind !== "ObjectTypeDefinition" ||
      !typeMatch(context)
    ) {
      return false;
    }
    const authSpec: AuthSpec = {
      provider: args.find((a) => a.name === "provider")?.value as any,
      actions: args.find((a) => a.name === "actions")?.value as any,
      strategy: args.find((a) => a.name === "strategy")?.value as any,
    };

    TableResource.table(node.name.value)?.addAuth(authSpec);
    return true;
  }

  nextWithField(
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
    const authSpec: AuthSpec = {
      provider: args.find((a) => a.name === "provider")?.value as any,
      actions: args.find((a) => a.name === "actions")?.value as any,
      strategy: args.find((a) => a.name === "strategy")?.value as any,
    };

    FunctionResource.function(node.name.value)?.addAuth(authSpec);
    return true;
  }
}
