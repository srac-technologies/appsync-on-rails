import { ASTNode } from "graphql";

export class TransformContext {
  constructor(public node: ASTNode, public parent: () => TransformContext) {}
}
