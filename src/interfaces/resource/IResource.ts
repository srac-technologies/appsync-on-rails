type Digger = (parent: any) => (value: any) => any;
export type ResourceDefinition = {
  location: string;
  path: string | Digger;
  resource: any;
};
