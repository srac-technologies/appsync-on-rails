import {
  DocumentNode,
  FieldDefinitionNode,
  InputValueDefinitionNode, parse
} from "graphql";
import directives from "../directives";
import { TransformContext } from "../interfaces/context/TransformContext";
import { IDirective } from "../interfaces/directive/Directive";

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
                d.arguments?.map((a) => ({
                  name: a.name.value,
                  value: a.value.kind === "StringValue" ? a.value.value : a.value.kind === 'ListValue' && a.value.values.map(v => v.kind === 'StringValue' && v.value) as string[] || "",
                })) || [],
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
                    d.arguments?.map((a) => ({
                      name: a.name.value,
                      value:
                        a.value.kind === "StringValue" ? a.value.value : "",
                    })) || [],
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
