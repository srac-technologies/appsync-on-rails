import { ASTNode } from "graphql";
import { TransformContext } from "../context/TransformContext";
import { IResource } from "../resource/IResource";

export type DirectiveArg = {
  name: string;
  value: string | string[];
};
export interface IDirective {
  next(
    name: string,
    args: DirectiveArg[],
    node: ASTNode,
    context: TransformContext
  ): IResource[] | false;
}
