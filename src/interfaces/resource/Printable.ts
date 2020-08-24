import { ResourceDefinition } from "./IResource";

export interface Printable {
    print(): ResourceDefinition[];
}