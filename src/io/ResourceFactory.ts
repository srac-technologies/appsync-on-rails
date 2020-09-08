import {
  DocumentNode,
  FieldDefinitionNode,
  InputValueDefinitionNode, parse, ArgumentNode, ValueNode
} from "graphql";
import directives from "../directives";
import { TransformContext } from "../interfaces/context/TransformContext";
import { IDirective } from "../interfaces/directive/Directive";

const parseDirectiveArg = (arg: ArgumentNode) => {
  const name = arg.name.value

  const next = (v: ValueNode): any => {
    switch (v.kind) {
      case "ObjectValue":
        return Object.fromEntries(v.fields.map(f => [f.name.value, next(f.value)]));
      case "StringValue":
        return v.value;
      case "ListValue":
        return v.values.map(value => next(value))
      default:
        return {}
    }
  }

  return {
    name,
    value: next(arg.value)
  }
}

export class ResourceFactory {
  node: DocumentNode;
  directives: IDirective[];
  constructor(input: string) {
    this.node = parse(input);
    this.directives = directives.map((ctor) => new ctor());
  }

  doWalk() {
    this.node.definitions.forEach((type) => {
      if (
        type.kind === "ObjectTypeDefinition" ||
        type.kind === "InputObjectTypeDefinition"
      ) {
        const typeContext = new TransformContext(
          type,
          () => new TransformContext(this.node, () => null as any)
        );
        // type handling
        (type.directives || []).forEach((d) => {
          this.directives
            .map((di) =>
              di.next(
                d.name.value,
                d.arguments?.map((a) => parseDirectiveArg(a)) || [],
                type,
                typeContext
              )
            )
        });
        // field handling
        (type.fields || []).forEach(
          (f: FieldDefinitionNode | InputValueDefinitionNode) =>
            (f.directives || []).forEach((d) =>
              this.directives
                .map((di) =>
                  di.next(
                    d.name.value,
                    d.arguments?.map((a) => parseDirectiveArg(a)) || [],
                    f,
                    new TransformContext(f, () => typeContext)
                  )
                )
            )
        );
        return;
      }
    });
  }
}
