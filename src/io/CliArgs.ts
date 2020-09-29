import yargs from "yargs";
import { TransformContext } from "../interfaces/context/TransformContext";
import { type } from "os";

export const args = yargs
  .option("base-dir", {
    description: "base dir of source.",
    defaultDescription: "process.cwd()",
    default: process.cwd(),
  })
  // .option("out-resource", {
  //   description:
  //     "relative path from base-dir, to put resource file related to cloudformation",
  //   defaultDescription: "${base-dir}/resources",
  //   default: "./resources",
  // })
  // .option("out-schema", {
  //   description: "relative path from base-dir, to put schema file",
  //   defaultDescription: "${base-dir}/schema",
  //   default: "./schema",
  // })
  .option("in-schema", {
    description: "relative path from base-dir, to get input schema file",
    defaultDescription: "${base-dir}/schema.graphql",
    default: "./schema.graphql",
  })
  .option("append-only", {
    description: "if true, it avoids rewriting existing file with same name",
    defaultDescription: "false",
    default: false,
    boolean: true,
  }).option("build-dir", {
    description:
      "directory to place build output",
    defaultDescription: "./build",
    default: './build',
  })
  .option("types", {
    description:
      "if specified other than 'all', outputs only related with specified type",
    defaultDescription: "all",
    default: ["all"],
    array: true,
  }).argv;

export const typeMatch = (context: TransformContext): boolean => {
  if (args.types.length == 1 && args.types[0] === "all") {
    return true;
  }
  if (
    (context.node.kind === "ObjectTypeDefinition" &&
      args.types.includes(context.node.name.value)) ||
    (context.node.kind === "InputObjectTypeDefinition" &&
      context.node.directives?.some(
        (n) =>
          n.name.value === "modelInput" &&
          n.arguments?.some(
            (a) =>
              a.name.value === "name" &&
              a.value.kind === "StringValue" &&
              args.types.includes(a.value.value)
          )
      ))
  ) {
    return true;
  }
  if (!context.parent()) {
    return false;
  }

  return typeMatch(context.parent());
};
