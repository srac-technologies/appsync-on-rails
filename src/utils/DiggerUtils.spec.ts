import {
  FieldDefinitionNode,
  parse,
  ObjectTypeDefinitionNode,
  print,
} from "graphql";
import { typeEasy, unTypeEasy } from "./DiggerUtils";

describe(`DiggerUtils#unTypeEasy`, () => {
  it(`should returns safe type when [String!]!`, () => {
    expect(
      unTypeEasy({
        kind: "FieldDefinition",
        name: { kind: "Name", value: "test" },
        type: {
          kind: "NonNullType",
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: {
                  kind: "Name",
                  value: "String",
                },
              },
            },
          },
        },
      })
    ).toEqual({
      required: true,
      list: true,
      baseTypeName: "String",
      listRequired: true,
    });
  });
  it(`should go back as it was when [String!]!`, () => {
    const o: FieldDefinitionNode = {
      kind: "FieldDefinition",
      name: { kind: "Name", value: "test" },
      type: {
        kind: "NonNullType",
        type: {
          kind: "ListType",
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: {
                kind: "Name",
                value: "String",
              },
            },
          },
        },
      },
    };
    expect(typeEasy(unTypeEasy(o))).toEqual(expect.objectContaining(o.type));
  });
  it(`should parsable when [String!]!`, () => {
    const o = (<ObjectTypeDefinitionNode>parse(`
      type Test {
        test: [String!]!
      }
    `).definitions[0]).fields?.[0];
    expect(print(typeEasy(unTypeEasy(o)))).toBe(`[String!]!`);
  });
});
