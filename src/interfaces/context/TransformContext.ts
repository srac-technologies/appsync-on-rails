import { ASTNode, DocumentNode } from "graphql";

export class TransformContext {
  constructor(public node: ASTNode, public parent: () => TransformContext) { }

  public getRoot() {
    const next = (t: TransformContext): DocumentNode => {
      const a = t.parent()
      if (t.node.kind === 'Document') {
        return t.node
      }
      return next(a)
    }
    return next(this)
  }
}
