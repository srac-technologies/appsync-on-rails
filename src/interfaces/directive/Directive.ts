import { ASTNode } from "graphql";
import { TransformContext } from "../context/TransformContext";

export type DirectiveArg = {
  name: string;
  value: string | string[] | any;
};
export interface IDirective {
  next(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ): void;
}
