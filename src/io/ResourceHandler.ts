import { DocumentNode, parse, print } from "graphql";
import path from "path";
import yaml from "yamljs";
import { ResourceDefinition } from "../interfaces/resource/IResource";
import { FsProxy } from "./FsProxy";

export class ResourceHandler {
  constructor(
    private resources: ResourceDefinition[],
    private basePath: string
  ) { }

  print() {
    // group order
    const resources = this.resources.reduce(
      (res: { [path: string]: ResourceDefinition[] }, elem) => ({
        ...res,
        [elem.location]: [...(res[elem.location] || []), elem],
      }),
      {}
    );

    return Object.entries(resources).map(([p, defs]) => {
      if (path.extname(p) === ".yml") {
        return {
          path: path.join(this.basePath, p),
          body: this.resolveYaml(p, defs),
          noReplace: defs.some(d => d.noReplace)
        };
      }
      if (path.extname(p) === ".graphql") {
        const body = print(this.resolveSchema(p, defs));
        return {
          path: path.join(this.basePath, p),
          body,
          noReplace: defs.some(d => d.noReplace)
        };
      }
      return {
        path: path.join(this.basePath, p),
        body: defs.map((d) => d.resource.toString()).join("\n"),
        noReplace: defs.some(d => d.noReplace)
      };
    });
  }

  resolveSchema(filePath: string, definitions: ResourceDefinition[]) {
    return definitions.reduce(
      (res, def) => {
        console.log(res, def.resource);
        if (!def.path) {
          try {
            return typeof def.resource === "string"
              ? parse(def.resource)
              : def.resource;
          } catch (e) {
            console.trace(def.resource);
            throw e;
          }
        }
        if (typeof def.path === "string") {
          return res;
        }
        return def.path(res)(def.resource);
      },
      <DocumentNode>{
        kind: "Document",
        definitions: [],
      }
    );
  }

  resolveYaml(filePath: string, definitions: ResourceDefinition[]) {
    const orig = FsProxy.instance.existsSync(path.join(this.basePath, filePath))
      ? yaml.parse(
        FsProxy.instance.readFileSync(path.join(this.basePath, filePath), {
          encoding: "utf-8",
        })
      )
      : {};
    return yaml.stringify(
      definitions.reduce((res, def) => {
        if (!def.path) {
          return def.resource;
        }
        const digger: (parent: any) => (value: any) => any =
          typeof def.path === "string"
            ? (parent: any) => {
              const lastOne = (<string>def.path)
                .split("#")
                .slice(0, -1)
                .reduce((from, loc) => {
                  if (loc in from) {
                    return from[loc];
                  }
                  from[loc] = {};
                  return from[loc];
                }, parent);
              const lastPath = (<string>def.path).split("#").pop();
              return (value: any) => {
                if (
                  lastPath &&
                  lastPath in lastOne &&
                  lastOne[lastPath].length
                ) {
                  lastOne[lastPath].push(value);
                  return parent;
                }
                lastPath && (lastOne[lastPath] = value);
                return parent;
              };
            }
            : def.path;
        return digger(res)(def.resource);
      }, orig),
      100,
      2
    );
  }
}
