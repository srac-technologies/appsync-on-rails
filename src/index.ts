import fs from "fs";
import path from "path";
import { ResourceDefinition } from "./interfaces/resource/IResource";
import { Printable } from "./interfaces/resource/Printable";
import { args } from "./io/CliArgs";
import { ResourceFactory } from "./io/ResourceFactory";
import { ResourceHandler } from "./io/ResourceHandler";
import { Resources } from './resources';

const p = args["base-dir"];
const out = args['build-dir']
const schema = args["in-schema"];

new ResourceFactory(fs.readFileSync(path.join(p, schema), { encoding: 'utf-8' })).doWalk()

new ResourceHandler(Resources.reduce((res: Printable[], r) => [...res, ...r.instances], [])
  .reduce((res: ResourceDefinition[], p) => [...res, ...p.print()], [{
    location: `schema/${schema}`,
    path: '',
    resource: fs.readFileSync(path.join(p, schema), { encoding: 'utf-8' })
  }])).print().forEach(resource => {
    const outPath = path.join(out, resource.path)
    const inPath = path.join(p, resource.path)
    if (!fs.existsSync(path.dirname(outPath))) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
    }
    if (!fs.existsSync(inPath)) {
      fs.writeFileSync(outPath, resource.body);
    } else {
      fs.copyFileSync(inPath, outPath)
    }
  });
