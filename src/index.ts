import fs from "fs";
import path from "path";
import yargs from "yargs";
import { FsProxy } from "./io/FsProxy";
import { ResourceFactory } from "./io/ResourceFactory";
import { ResourceHandler } from "./io/ResourceHandler";
import { args } from "./io/CliArgs";

const p = args["base-dir"];
const schema = args["in-schema"];

const recursiveWalk = (
  input: string,
  output: { path: string; body: string }[]
): { path: string; body: string }[] => {
  try {
    const res = new ResourceFactory(input).doWalk();
    if (!res) {
      return output;
    }
    const op = new ResourceHandler(res, p).print();
    op.forEach((o) => FsProxy.instance.accept(o.path, o.body, p));
    return op.reduce(
      (o, i) =>
        path.extname(i.path) === ".graphql" ? recursiveWalk(i.body, o) : o,
      [...output, ...op]
    );
  } catch (e) {
    console.error(e);
    console.trace(input);
    throw e;
  }
};

FsProxy.instance.accept(
  path.join(p, "schema", schema),
  fs.readFileSync(path.join(p, schema), { encoding: "utf-8" }),
  args["base-dir"]
);

recursiveWalk(fs.readFileSync(path.join(p, schema), { encoding: "utf-8" }), [
  {
    body: fs.readFileSync(path.join(p, schema), { encoding: "utf-8" }),
    path: path.join(p, "schema", schema),
  },
]).forEach((p) => {
  !fs.existsSync(path.dirname(p.path)) &&
    fs.mkdirSync(path.dirname(p.path), { recursive: true });
  if (args["append-only"] && fs.existsSync(p.path)) {
    return;
  }
  fs.writeFileSync(p.path, p.body);
});
