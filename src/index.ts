import fs from "fs";
import path from "path";
import { ResourceDefinition } from "./interfaces/resource/IResource";
import { Printable } from "./interfaces/resource/Printable";
import { args } from "./io/CliArgs";
import { ResourceFactory } from "./io/ResourceFactory";
import { ResourceHandler } from "./io/ResourceHandler";
import { Resources } from './resources';

const p = args["base-dir"];
const schema = args["in-schema"];

new ResourceFactory(fs.readFileSync(path.join(p, schema), { encoding: 'utf-8' })).doWalk()

new ResourceHandler(Resources.reduce((res: Printable[], r) => [...res, ...r.instances], [])
  .reduce((res: ResourceDefinition[], p) => [...res, ...p.print()], [{
    location: `schema/${schema}`,
    path: '',
    resource: fs.readFileSync(path.join(p, schema), { encoding: 'utf-8' })
  }]), p).print().forEach(resource => {
    if (!fs.existsSync(path.dirname(resource.path))) {
      fs.mkdirSync(path.dirname(resource.path), { recursive: true });
    }
    if (!fs.existsSync(resource.path) || (!args["append-only"] && !resource.noReplace)) {
      fs.writeFileSync(resource.path, resource.body);
    }
  });
